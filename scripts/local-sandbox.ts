#!/usr/bin/env bun
/**
 * Local sandbox server for dev mode.
 * Implements the same HTTP API as the remote sandbox runner so
 * RemoteSandboxServiceClient can talk to it without changes.
 *
 * Run: bun run scripts/local-sandbox.ts
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { execSync, spawn, type ChildProcess } from 'child_process';

const PORT = Number(process.env.LOCAL_SANDBOX_PORT) || 8976;
const WORKSPACE_ROOT = join(process.cwd(), '.local-workspaces');

/**
 * Maps local sandbox ports to Replit external port numbers.
 * Must match the [[ports]] entries in .replit.
 */
const LOCAL_TO_EXTERNAL_PORT: Record<number, number> = {
        4100: 5173,
        4101: 8008,
        4102: 8081,
        4103: 8082,
        4104: 8083,
        4105: 8084,
};

/**
 * Builds the correct preview URL for a sandbox instance.
 * Inside Replit the browser cannot reach localhost, so we construct
 * the public proxied HTTPS URL using REPLIT_DEV_DOMAIN.
 */
function buildPreviewUrl(port: number): string {
        const replitDomain = process.env.REPLIT_DEV_DOMAIN;
        if (replitDomain) {
                const externalPort = LOCAL_TO_EXTERNAL_PORT[port];
                if (externalPort) {
                        const dot = replitDomain.indexOf('.');
                        const subdomain = replitDomain.slice(0, dot);
                        const suffix = replitDomain.slice(dot);
                        return `https://${subdomain}-${externalPort}${suffix}`;
                }
                console.warn(`[sandbox] No Replit external port mapping for local port ${port} — falling back to localhost URL`);
        }
        return `http://localhost:${port}`;
}

interface LocalInstance {
        id: string;
        projectName: string;
        workDir: string;
        startTime: string;
        process: ChildProcess | null;
        port: number;
        stdout: string;
        stderr: string;
        errors: Array<{ timestamp: string; level: number; message: string; rawOutput: string }>;
}

let nextPort = 4100;
const instances = new Map<string, LocalInstance>();

function ensureDir(dir: string) {
        if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
        }
}

function execInDir(command: string, cwd: string, timeout = 60_000) {
        try {
                const stdout = execSync(command, {
                        cwd,
                        timeout,
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        env: { ...process.env, FORCE_COLOR: '0' },
                });
                return { stdout, stderr: '', exitCode: 0 };
        } catch (err: unknown) {
                const e = err as { stdout?: string; stderr?: string; status?: number };
                return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status ?? 1 };
        }
}

function listFilesRecursive(dir: string, baseDir: string): string[] {
        const skip = new Set(['node_modules', '.git', 'dist', '.wrangler', '.next', '.cache', 'bun.lock']);
        const result: string[] = [];
        try {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                        if (skip.has(entry.name)) continue;
                        const full = join(dir, entry.name);
                        if (entry.isDirectory()) {
                                result.push(...listFilesRecursive(full, baseDir));
                        } else {
                                result.push(relative(baseDir, full));
                        }
                }
        } catch { /* unreadable dir */ }
        return result;
}

function createInstance(body: {
        files: Array<{ filePath: string; fileContents: string }>;
        projectName: string;
        envVars?: Record<string, string>;
        initCommand?: string;
}) {
        const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workDir = join(WORKSPACE_ROOT, id);
        ensureDir(workDir);

        for (const file of body.files) {
                const fp = join(workDir, file.filePath);
                ensureDir(dirname(fp));
                if (file.fileContents.startsWith('base64:')) {
                        writeFileSync(fp, Buffer.from(file.fileContents.slice(7), 'base64'));
                } else {
                        writeFileSync(fp, file.fileContents, 'utf-8');
                }
        }

        if (body.envVars && Object.keys(body.envVars).length > 0) {
                const content = Object.entries(body.envVars).map(([k, v]) => `${k}=${v}`).join('\n');
                writeFileSync(join(workDir, '.dev.vars'), content, 'utf-8');
        }

        const port = nextPort++;
        const inst: LocalInstance = {
                id,
                projectName: body.projectName,
                workDir,
                startTime: new Date().toISOString(),
                process: null,
                port,
                stdout: '',
                stderr: '',
                errors: [],
        };

        // Install deps
        if (existsSync(join(workDir, 'package.json'))) {
                console.log(`[sandbox] Installing deps for ${id}...`);
                execInDir('bun install --no-progress 2>&1 || npm install 2>&1', workDir, 120_000);
        }

        // Start dev server
        const initCommand = body.initCommand || 'bun run dev';
        const portedCommand = initCommand
                .replace(/bun run dev/, `bun run dev -- --port ${port} --host 0.0.0.0`)
                .replace(/npm run dev/, `npm run dev -- --port ${port} --host 0.0.0.0`);

        console.log(`[sandbox] Starting ${portedCommand} in ${workDir} on port ${port}`);

        const proc = spawn('sh', ['-c', portedCommand], {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PORT: String(port), ...(body.envVars || {}) },
                detached: true,
        });

        proc.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                inst.stdout += text;
                if (inst.stdout.length > 50_000) inst.stdout = inst.stdout.slice(-40_000);
        });

        proc.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                inst.stderr += text;
                if (inst.stderr.length > 50_000) inst.stderr = inst.stderr.slice(-40_000);
                if (text.toLowerCase().includes('error') && !text.toLowerCase().includes('deprecation')) {
                        inst.errors.push({
                                timestamp: new Date().toISOString(),
                                level: 50,
                                message: text.trim().slice(0, 500),
                                rawOutput: text.trim().slice(0, 1000),
                        });
                }
        });

        proc.on('exit', (code) => {
                console.log(`[sandbox] Process for ${id} exited with code ${code}`);
                inst.process = null;
        });

        inst.process = proc;
        instances.set(id, inst);
        return inst;
}

// -- HTTP Server --

const server = Bun.serve({
        port: PORT,
        async fetch(req) {
                const url = new URL(req.url);
                const path = url.pathname;
                const method = req.method;

                // CORS
                if (method === 'OPTIONS') {
                        return new Response(null, {
                                headers: {
                                        'Access-Control-Allow-Origin': '*',
                                        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                                        'Access-Control-Allow-Headers': '*',
                                },
                        });
                }

                const json = (data: unknown, status = 200) =>
                        new Response(JSON.stringify(data), {
                                status,
                                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                        });

                try {
                        // POST /instances -- create
                        if (method === 'POST' && path === '/instances') {
                                const body = await req.json();
                                const inst = createInstance(body);
                                return json({
                                        success: true,
                                        runId: inst.id,
                                        processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                                        previewURL: buildPreviewUrl(inst.port),
                                        message: `Local instance created at ${inst.workDir}`,
                                });
                        }

                        // GET /instances -- list all
                        if (method === 'GET' && path === '/instances') {
                                const list = Array.from(instances.values()).map(inst => ({
                                        runId: inst.id,
                                        startTime: inst.startTime,
                                        uptime: (Date.now() - new Date(inst.startTime).getTime()) / 1000,
                                        previewURL: buildPreviewUrl(inst.port),
                                        directory: inst.workDir,
                                        serviceDirectory: inst.workDir,
                                }));
                                return json({ success: true, instances: list, count: list.length });
                        }

                        // Match /instances/:id routes
                        const instanceMatch = path.match(/^\/instances\/([^/]+)(\/.*)?$/);
                        if (instanceMatch) {
                                const instanceId = instanceMatch[1];
                                const subPath = instanceMatch[2] || '';
                                const inst = instances.get(instanceId);

                                if (!inst) {
                                        return json({ success: false, error: `Instance ${instanceId} not found` }, 404);
                                }

                                // GET /instances/:id
                                if (method === 'GET' && subPath === '') {
                                        return json({
                                                success: true,
                                                instance: {
                                                        runId: inst.id,
                                                        startTime: inst.startTime,
                                                        uptime: (Date.now() - new Date(inst.startTime).getTime()) / 1000,
                                                        previewURL: `http://localhost:${inst.port}`,
                                                        directory: inst.workDir,
                                                        serviceDirectory: inst.workDir,
                                                        processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                                                        runtimeErrors: inst.errors,
                                                },
                                        });
                                }

                                // GET /instances/:id/status
                                if (method === 'GET' && subPath === '/status') {
                                        const isRunning = inst.process !== null && inst.process.exitCode === null;
                                        return json({
                                                success: true,
                                                pending: false,
                                                isHealthy: isRunning,
                                                previewURL: `http://localhost:${inst.port}`,
                                                processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                                        });
                                }

                                // POST /instances/:id/files -- write files
                                if (method === 'POST' && subPath === '/files') {
                                        const body = await req.json();
                                        const results: Array<{ file: string; success: boolean; error?: string }> = [];
                                        for (const file of body.files) {
                                                try {
                                                        const fp = join(inst.workDir, file.filePath);
                                                        ensureDir(dirname(fp));
                                                        if (file.fileContents.startsWith('base64:')) {
                                                                writeFileSync(fp, Buffer.from(file.fileContents.slice(7), 'base64'));
                                                        } else {
                                                                writeFileSync(fp, file.fileContents, 'utf-8');
                                                        }
                                                        results.push({ file: file.filePath, success: true });
                                                } catch (err: unknown) {
                                                        const e = err as Error;
                                                        results.push({ file: file.filePath, success: false, error: e.message });
                                                }
                                        }
                                        return json({ success: results.every(r => r.success), results });
                                }

                                // GET /instances/:id/files
                                if (method === 'GET' && subPath === '/files') {
                                        const filePathsParam = url.searchParams.get('filePaths');
                                        const paths = filePathsParam ? JSON.parse(decodeURIComponent(filePathsParam)) : listFilesRecursive(inst.workDir, inst.workDir);
                                        const files: Array<{ filePath: string; fileContents: string }> = [];
                                        const errors: Array<{ file: string; error: string }> = [];
                                        for (const fp of paths) {
                                                try {
                                                        files.push({ filePath: fp, fileContents: readFileSync(join(inst.workDir, fp), 'utf-8') });
                                                } catch (err: unknown) {
                                                        errors.push({ file: fp, error: (err as Error).message });
                                                }
                                        }
                                        return json({ success: true, files, errors: errors.length ? errors : undefined });
                                }

                                // GET /instances/:id/logs
                                if (method === 'GET' && subPath === '/logs') {
                                        return json({ success: true, logs: { stdout: inst.stdout, stderr: inst.stderr } });
                                }

                                // POST /instances/:id/commands
                                if (method === 'POST' && subPath === '/commands') {
                                        const body = await req.json();
                                        const timeout = body.timeout || 60_000;
                                        const results = (body.commands as string[]).map((cmd: string) => {
                                                const r = execInDir(cmd, inst.workDir, timeout);
                                                return { command: cmd, success: r.exitCode === 0, output: r.stdout, error: r.stderr || undefined, exitCode: r.exitCode };
                                        });
                                        return json({ success: results.every(r => r.success), results });
                                }

                                // GET /instances/:id/errors
                                if (method === 'GET' && subPath === '/errors') {
                                        return json({ success: true, errors: inst.errors, hasErrors: inst.errors.length > 0 });
                                }

                                // DELETE /instances/:id/errors
                                if (method === 'DELETE' && subPath === '/errors') {
                                        inst.errors = [];
                                        return json({ success: true, message: 'Errors cleared' });
                                }

                                // GET /instances/:id/analysis
                                if (method === 'GET' && subPath === '/analysis') {
                                        const tsc = execInDir('npx tsc --noEmit --pretty false 2>&1 || true', inst.workDir, 60_000);
                                        return json({
                                                success: true,
                                                lint: { issues: [], rawOutput: '' },
                                                typecheck: { issues: [], rawOutput: tsc.stdout },
                                        });
                                }

                                // POST /instances/:id/deploy
                                if (method === 'POST' && subPath === '/deploy') {
                                        return json({
                                                success: false,
                                                message: 'Deployment not available in local dev mode. Use bun run deploy from the project directory.',
                                        });
                                }

                                // POST /instances/:id/name
                                if (method === 'POST' && subPath === '/name') {
                                        const body = await req.json();
                                        inst.projectName = body.projectName;
                                        return json({ success: true });
                                }

                                // DELETE /instances/:id -- shutdown
                                if (method === 'DELETE' && subPath === '') {
                                        if (inst.process && inst.process.exitCode === null) {
                                                try {
                                                        if (inst.process.pid) process.kill(-inst.process.pid, 'SIGTERM');
                                                } catch {
                                                        inst.process.kill('SIGKILL');
                                                }
                                        }
                                        instances.delete(instanceId);
                                        return json({ success: true, message: `Instance ${instanceId} shut down` });
                                }
                        }

                        return json({ error: 'Not found' }, 404);
                } catch (err: unknown) {
                        console.error('[sandbox] Error:', err);
                        return json({ success: false, error: (err as Error).message }, 500);
                }
        },
});

ensureDir(WORKSPACE_ROOT);
console.log(`[local-sandbox] Running on http://localhost:${PORT}`);
console.log(`[local-sandbox] Workspaces: ${WORKSPACE_ROOT}`);

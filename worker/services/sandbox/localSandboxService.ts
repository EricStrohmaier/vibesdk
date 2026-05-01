import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';

import { BaseSandboxService } from './BaseSandboxService';
import { createObjectLogger } from '../../logger';
import type { DeploymentTarget } from 'worker/agents/core/types';
import type {
        BootstrapResponse,
        GetInstanceResponse,
        BootstrapStatusResponse,
        ShutdownResponse,
        WriteFilesRequest,
        WriteFilesResponse,
        GetFilesResponse,
        ExecuteCommandsResponse,
        RuntimeErrorResponse,
        ClearErrorsResponse,
        StaticAnalysisResponse,
        DeploymentResult,
        GetLogsResponse,
        ListInstancesResponse,
        InstanceCreationRequest,
        RuntimeError,
        CommandExecutionResult,
} from './sandboxTypes';

const LOCAL_WORKSPACE_ROOT = path.resolve('.local-workspaces');

interface LocalInstance {
        instanceId: string;
        projectName: string;
        workDir: string;
        startTime: string;
        process: childProcess.ChildProcess | null;
        port: number;
        stdout: string;
        stderr: string;
        errors: RuntimeError[];
}

let nextPort = 4100;
const instances = new Map<string, LocalInstance>();

/**
 * Maps local sandbox ports to their Replit external port equivalents.
 * These must match the [[ports]] entries in .replit.
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
 * Builds the preview URL for a sandbox instance.
 * When running inside Replit (REPLIT_DEV_DOMAIN is set), constructs the
 * correct proxied HTTPS URL instead of a bare localhost address that the
 * browser cannot reach.
 */
function buildPreviewUrl(port: number): string {
        const replitDomain = process.env.REPLIT_DEV_DOMAIN;
        if (replitDomain) {
                const externalPort = LOCAL_TO_EXTERNAL_PORT[port];
                if (externalPort) {
                        const firstDot = replitDomain.indexOf('.');
                        const subdomain = replitDomain.slice(0, firstDot);
                        const suffix = replitDomain.slice(firstDot);
                        return `https://${subdomain}-${externalPort}${suffix}`;
                }
        }
        return `http://localhost:${port}`;
}

function ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
        }
}

function execInDir(command: string, cwd: string, timeout = 60_000): { stdout: string; stderr: string; exitCode: number } {
        try {
                const result = childProcess.execSync(command, {
                        cwd,
                        timeout,
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        env: { ...process.env, FORCE_COLOR: '0' },
                });
                return { stdout: result, stderr: '', exitCode: 0 };
        } catch (err: unknown) {
                const e = err as { stdout?: string; stderr?: string; status?: number };
                return {
                        stdout: e.stdout || '',
                        stderr: e.stderr || '',
                        exitCode: e.status ?? 1,
                };
        }
}

export class LocalSandboxService extends BaseSandboxService {
        constructor(sandboxId: string) {
                super(sandboxId);
                this.logger = createObjectLogger(this, 'LocalSandboxService');
                this.logger.info('LocalSandboxService initialized (dev mode)', { sandboxId });
        }

        async initialize(): Promise<void> {
                ensureDir(LOCAL_WORKSPACE_ROOT);
                this.logger.info('Local workspace root ready', { path: LOCAL_WORKSPACE_ROOT });
        }

        async createInstance(options: InstanceCreationRequest): Promise<BootstrapResponse> {
                const instanceId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const workDir = path.join(LOCAL_WORKSPACE_ROOT, instanceId);

                try {
                        ensureDir(workDir);

                        for (const file of options.files) {
                                const filePath = path.join(workDir, file.filePath);
                                ensureDir(path.dirname(filePath));

                                if (file.fileContents.startsWith('base64:')) {
                                        const buffer = Buffer.from(file.fileContents.slice(7), 'base64');
                                        fs.writeFileSync(filePath, buffer);
                                } else {
                                        fs.writeFileSync(filePath, file.fileContents, 'utf-8');
                                }
                        }

                        if (options.envVars && Object.keys(options.envVars).length > 0) {
                                const envContent = Object.entries(options.envVars)
                                        .map(([k, v]) => `${k}=${v}`)
                                        .join('\n');
                                fs.writeFileSync(path.join(workDir, '.dev.vars'), envContent, 'utf-8');
                        }

                        const port = nextPort++;
                        const instance: LocalInstance = {
                                instanceId,
                                projectName: options.projectName,
                                workDir,
                                startTime: new Date().toISOString(),
                                process: null,
                                port,
                                stdout: '',
                                stderr: '',
                                errors: [],
                        };

                        // Install dependencies
                        this.logger.info('Installing dependencies', { instanceId });
                        const packageJsonPath = path.join(workDir, 'package.json');
                        if (fs.existsSync(packageJsonPath)) {
                                const installResult = execInDir('bun install --no-progress 2>&1 || npm install 2>&1', workDir, 120_000);
                                if (installResult.exitCode !== 0) {
                                        this.logger.warn('Dependency install had issues', { stderr: installResult.stderr.slice(0, 500) });
                                }
                        }

                        // Start dev server
                        const initCommand = options.initCommand || 'bun run dev';
                        const portedCommand = initCommand.replace(
                                /bun run dev/,
                                `bun run dev -- --port ${port} --host 0.0.0.0`
                        ).replace(
                                /npm run dev/,
                                `npm run dev -- --port ${port} --host 0.0.0.0`
                        );

                        this.logger.info('Starting dev server', { instanceId, command: portedCommand, port });

                        const proc = childProcess.spawn('sh', ['-c', portedCommand], {
                                cwd: workDir,
                                stdio: ['pipe', 'pipe', 'pipe'],
                                env: { ...process.env, PORT: String(port), ...(options.envVars || {}) },
                                detached: true,
                        });

                        proc.stdout?.on('data', (data: Buffer) => {
                                const text = data.toString();
                                instance.stdout += text;
                                // Keep only last 50KB of logs
                                if (instance.stdout.length > 50_000) {
                                        instance.stdout = instance.stdout.slice(-40_000);
                                }
                        });

                        proc.stderr?.on('data', (data: Buffer) => {
                                const text = data.toString();
                                instance.stderr += text;
                                if (instance.stderr.length > 50_000) {
                                        instance.stderr = instance.stderr.slice(-40_000);
                                }

                                if (text.toLowerCase().includes('error') && !text.toLowerCase().includes('deprecation')) {
                                        instance.errors.push({
                                                timestamp: new Date().toISOString(),
                                                level: 50,
                                                message: text.trim().slice(0, 500),
                                                rawOutput: text.trim().slice(0, 1000),
                                        });
                                }
                        });

                        proc.on('exit', (code) => {
                                this.logger.info('Dev server process exited', { instanceId, code });
                                instance.process = null;
                        });

                        instance.process = proc;
                        instances.set(instanceId, instance);

                        const previewURL = buildPreviewUrl(port);
                        return {
                                success: true,
                                runId: instanceId,
                                processId: String(proc.pid),
                                previewURL,
                                message: `Local instance created at ${workDir}`,
                        };
                } catch (error) {
                        return {
                                success: false,
                                error: `Failed to create local instance: ${error instanceof Error ? error.message : String(error)}`,
                        };
                }
        }

        async listAllInstances(): Promise<ListInstancesResponse> {
                const instanceList = Array.from(instances.values()).map(inst => ({
                        runId: inst.instanceId,
                        startTime: inst.startTime,
                        uptime: (Date.now() - new Date(inst.startTime).getTime()) / 1000,
                        previewURL: buildPreviewUrl(inst.port),
                        directory: inst.workDir,
                        serviceDirectory: inst.workDir,
                        processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                }));

                return { success: true, instances: instanceList, count: instanceList.length };
        }

        async getInstanceDetails(instanceId: string): Promise<GetInstanceResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, error: `Instance ${instanceId} not found` };
                }

                return {
                        success: true,
                        instance: {
                                runId: inst.instanceId,
                                startTime: inst.startTime,
                                uptime: (Date.now() - new Date(inst.startTime).getTime()) / 1000,
                                previewURL: buildPreviewUrl(inst.port),
                                directory: inst.workDir,
                                serviceDirectory: inst.workDir,
                                processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                                runtimeErrors: inst.errors,
                        },
                };
        }

        async getInstanceStatus(instanceId: string): Promise<BootstrapStatusResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, pending: false, isHealthy: false, error: `Instance ${instanceId} not found` };
                }

                const isRunning = inst.process !== null && inst.process.exitCode === null;
                return {
                        success: true,
                        pending: false,
                        isHealthy: isRunning,
                        previewURL: buildPreviewUrl(inst.port),
                        processId: inst.process?.pid ? String(inst.process.pid) : undefined,
                };
        }

        async shutdownInstance(instanceId: string): Promise<ShutdownResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, error: `Instance ${instanceId} not found` };
                }

                if (inst.process && inst.process.exitCode === null) {
                        try {
                                if (inst.process.pid) {
                                        process.kill(-inst.process.pid, 'SIGTERM');
                                }
                        } catch {
                                inst.process.kill('SIGKILL');
                        }
                }

                instances.delete(instanceId);
                return { success: true, message: `Instance ${instanceId} shut down` };
        }

        async writeFiles(instanceId: string, files: WriteFilesRequest['files']): Promise<WriteFilesResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, results: [], error: `Instance ${instanceId} not found` };
                }

                const results: Array<{ file: string; success: boolean; error?: string }> = [];

                for (const file of files) {
                        try {
                                const filePath = path.join(inst.workDir, file.filePath);
                                ensureDir(path.dirname(filePath));

                                if (file.fileContents.startsWith('base64:')) {
                                        const buffer = Buffer.from(file.fileContents.slice(7), 'base64');
                                        fs.writeFileSync(filePath, buffer);
                                } else {
                                        fs.writeFileSync(filePath, file.fileContents, 'utf-8');
                                }
                                results.push({ file: file.filePath, success: true });
                        } catch (err) {
                                results.push({
                                        file: file.filePath,
                                        success: false,
                                        error: err instanceof Error ? err.message : String(err),
                                });
                        }
                }

                const allSuccess = results.every(r => r.success);
                return { success: allSuccess, results, message: `Wrote ${results.filter(r => r.success).length}/${files.length} files` };
        }

        async getFiles(instanceId: string, filePaths?: string[]): Promise<GetFilesResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, files: [], error: `Instance ${instanceId} not found` };
                }

                const files: Array<{ filePath: string; fileContents: string }> = [];
                const errors: Array<{ file: string; error: string }> = [];

                const paths = filePaths || this.listFilesRecursive(inst.workDir, inst.workDir);

                for (const fp of paths) {
                        try {
                                const fullPath = path.join(inst.workDir, fp);
                                const contents = fs.readFileSync(fullPath, 'utf-8');
                                files.push({ filePath: fp, fileContents: contents });
                        } catch (err) {
                                errors.push({ file: fp, error: err instanceof Error ? err.message : String(err) });
                        }
                }

                return { success: true, files, errors: errors.length > 0 ? errors : undefined };
        }

        private listFilesRecursive(dir: string, baseDir: string): string[] {
                const result: string[] = [];
                const skipDirs = new Set(['node_modules', '.git', 'dist', '.wrangler', '.next', '.cache']);
                try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                                if (skipDirs.has(entry.name)) continue;
                                const fullPath = path.join(dir, entry.name);
                                const relPath = path.relative(baseDir, fullPath);
                                if (entry.isDirectory()) {
                                        result.push(...this.listFilesRecursive(fullPath, baseDir));
                                } else {
                                        result.push(relPath);
                                }
                        }
                } catch {
                        // directory not readable
                }
                return result;
        }

        async getLogs(instanceId: string): Promise<GetLogsResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, logs: { stdout: '', stderr: '' }, error: `Instance ${instanceId} not found` };
                }

                return {
                        success: true,
                        logs: { stdout: inst.stdout, stderr: inst.stderr },
                };
        }

        async executeCommands(instanceId: string, commands: string[], timeout?: number): Promise<ExecuteCommandsResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, results: [], error: `Instance ${instanceId} not found` };
                }

                const results: CommandExecutionResult[] = [];
                const cmdTimeout = timeout || 60_000;

                for (const command of commands) {
                        const result = execInDir(command, inst.workDir, cmdTimeout);
                        results.push({
                                command,
                                success: result.exitCode === 0,
                                output: result.stdout,
                                error: result.stderr || undefined,
                                exitCode: result.exitCode,
                        });
                }

                const allSuccess = results.every(r => r.success);
                return { success: allSuccess, results };
        }

        async updateProjectName(instanceId: string, projectName: string): Promise<boolean> {
                const inst = instances.get(instanceId);
                if (!inst) return false;
                inst.projectName = projectName;
                return true;
        }

        async getInstanceErrors(instanceId: string, clear?: boolean): Promise<RuntimeErrorResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, errors: [], hasErrors: false, error: `Instance ${instanceId} not found` };
                }

                const errors = [...inst.errors];
                if (clear) {
                        inst.errors = [];
                }

                return { success: true, errors, hasErrors: errors.length > 0 };
        }

        async clearInstanceErrors(instanceId: string): Promise<ClearErrorsResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return { success: false, error: `Instance ${instanceId} not found` };
                }

                inst.errors = [];
                return { success: true, message: 'Errors cleared' };
        }

        async runStaticAnalysisCode(instanceId: string, lintFiles?: string[]): Promise<StaticAnalysisResponse> {
                const inst = instances.get(instanceId);
                if (!inst) {
                        return {
                                success: false,
                                lint: { issues: [] },
                                typecheck: { issues: [] },
                                error: `Instance ${instanceId} not found`,
                        };
                }

                const lintResult = execInDir(
                        'npx eslint . --format json 2>/dev/null || echo "[]"',
                        inst.workDir,
                        30_000,
                );

                const tscResult = execInDir(
                        'npx tsc --noEmit --pretty false 2>&1 || true',
                        inst.workDir,
                        60_000,
                );

                return {
                        success: true,
                        lint: {
                                issues: [],
                                rawOutput: lintResult.stdout,
                        },
                        typecheck: {
                                issues: [],
                                rawOutput: tscResult.stdout,
                        },
                };
        }

        async deployToCloudflareWorkers(_instanceId: string, _target?: DeploymentTarget): Promise<DeploymentResult> {
                return {
                        success: false,
                        message: 'Deployment to Cloudflare Workers is not available in local dev mode. Use `bun run deploy` from the project directory.',
                };
        }
}

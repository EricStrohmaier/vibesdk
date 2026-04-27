// import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';
import https from 'https';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

const devAIProxyPlugin = {
        name: 'dev-ai-proxy',
        configureServer(server: any) {
                server.middlewares.use('/dev-proxy/google-ai-studio', (req: any, res: any) => {
                        const urlPath = req.url || '/';
                        const targetUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/openai${urlPath}`);

                        const proxyHeaders: Record<string, string> = {
                                host: targetUrl.hostname,
                        };
                        if (req.headers['content-type']) proxyHeaders['content-type'] = req.headers['content-type'];
                        if (req.headers['authorization']) proxyHeaders['authorization'] = req.headers['authorization'];
                        if (req.headers['content-length']) proxyHeaders['content-length'] = req.headers['content-length'];
                        if (req.headers['accept']) proxyHeaders['accept'] = req.headers['accept'];

                        const options: https.RequestOptions = {
                                hostname: targetUrl.hostname,
                                port: 443,
                                path: targetUrl.pathname + targetUrl.search,
                                method: req.method,
                                headers: proxyHeaders,
                        };

                        const proxyReq = https.request(options, (proxyRes) => {
                                const responseHeaders: Record<string, string | string[]> = {};
                                if (proxyRes.headers['content-type']) responseHeaders['content-type'] = proxyRes.headers['content-type'];
                                if (proxyRes.headers['transfer-encoding']) responseHeaders['transfer-encoding'] = proxyRes.headers['transfer-encoding'];
                                if (proxyRes.headers['cache-control']) responseHeaders['cache-control'] = proxyRes.headers['cache-control'];
                                responseHeaders['access-control-allow-origin'] = '*';

                                res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                                proxyRes.pipe(res, { end: true });
                        });

                        proxyReq.on('error', (err: Error) => {
                                console.error('[dev-ai-proxy] Proxy error:', err.message);
                                if (!res.headersSent) {
                                        res.writeHead(502, { 'content-type': 'application/json' });
                                }
                                res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
                        });

                        req.pipe(proxyReq, { end: true });
                });
        },
};

// https://vite.dev/config/
export default defineConfig({
        optimizeDeps: {
                exclude: ['format', 'editor.all'],
                include: ['monaco-editor/esm/vs/editor/editor.api'],
                force: true,
        },

        plugins: [
                devAIProxyPlugin,
                react(),
                svgr(),
                cloudflare({
                        configPath: 'wrangler.jsonc',
                        remoteBindings: false,
                }),
                tailwindcss(),
        ],

        resolve: {
                alias: {
                        debug: 'debug/src/browser',
                        '@': path.resolve(__dirname, './src'),
                        'shared': path.resolve(__dirname, './shared'),
                        'worker': path.resolve(__dirname, './worker'),
                },
        },

        define: {
                'process.env.NODE_ENV': JSON.stringify(
                        process.env.NODE_ENV || 'development',
                ),
                global: 'globalThis',
        },

        worker: {
                format: 'es',
        },

        server: {
                allowedHosts: true,
                host: '0.0.0.0',
                port: 5000,
                watch: {
                        ignored: ['**/.cache/**', '**/templates/**', '**/.wrangler/**'],
                },
        },

        cacheDir: 'node_modules/.vite',
});

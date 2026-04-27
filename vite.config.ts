// import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';
import https from 'https';
import http from 'http';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

const AI_PROXY_PORT = 5001;

const devAIProxyPlugin = {
	name: 'dev-ai-proxy',
	configureServer(server: ViteDevServer) {
		const proxyServer = http.createServer((req, res) => {
			if (req.method === 'OPTIONS') {
				res.writeHead(204, {
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
					'access-control-allow-headers': 'content-type,authorization,x-goog-api-key',
				});
				res.end();
				return;
			}

			const urlPath = req.url || '/';
			const targetUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/openai${urlPath}`);

			const proxyHeaders: Record<string, string> = {
				host: targetUrl.hostname,
			};
			if (req.headers['content-type']) proxyHeaders['content-type'] = req.headers['content-type'] as string;
			if (req.headers['authorization']) proxyHeaders['authorization'] = req.headers['authorization'] as string;
			if (req.headers['content-length']) proxyHeaders['content-length'] = req.headers['content-length'] as string;
			if (req.headers['accept']) proxyHeaders['accept'] = req.headers['accept'] as string;

			const options: https.RequestOptions = {
				hostname: targetUrl.hostname,
				port: 443,
				path: targetUrl.pathname + targetUrl.search,
				method: req.method,
				headers: proxyHeaders,
			};

			const proxyReq = https.request(options, (proxyRes) => {
				const responseHeaders: Record<string, string | string[]> = {
					'access-control-allow-origin': '*',
				};
				for (const h of ['content-type', 'transfer-encoding', 'cache-control', 'content-encoding']) {
					if (proxyRes.headers[h]) responseHeaders[h] = proxyRes.headers[h] as string;
				}

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

		proxyServer.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.warn(`[dev-ai-proxy] Port ${AI_PROXY_PORT} already in use — another proxy instance may be running`);
			} else {
				console.error('[dev-ai-proxy] Server error:', err.message);
			}
		});

		proxyServer.listen(AI_PROXY_PORT, '0.0.0.0', () => {
			console.log(`[dev-ai-proxy] Google AI Studio proxy running on http://localhost:${AI_PROXY_PORT}`);
		});

		server.httpServer?.once('close', () => {
			proxyServer.close();
		});

		// Do NOT return a function — returning from configureServer calls it as
		// a post-middleware hook immediately, which would close the proxy server.
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

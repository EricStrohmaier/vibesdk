// import { sentryVitePlugin } from '@sentry/vite-plugin';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

import tailwindcss from '@tailwindcss/vite';

const LIVE_BACKEND = 'https://app.alpen.digital';

// https://vite.dev/config/
export default defineConfig({
        optimizeDeps: {
                exclude: ['format', 'editor.all'],
                include: ['monaco-editor/esm/vs/editor/editor.api'],
                force: true,
        },

        plugins: [
                react(),
                svgr(),
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

        // Configure for Prisma + Cloudflare Workers compatibility
        define: {
                // Ensure proper module definitions for Cloudflare Workers context
                'process.env.NODE_ENV': JSON.stringify(
                        process.env.NODE_ENV || 'development',
                ),
                global: 'globalThis',
                // '__filename': '""',
                // '__dirname': '""',
        },

        server: {
                allowedHosts: true,
                proxy: {
                        '/api': {
                                target: LIVE_BACKEND,
                                changeOrigin: true,
                                secure: true,
                                ws: true,
                                // Strip Domain from Set-Cookie so cookies apply to the
                                // Replit dev domain instead of app.alpen.digital
                                cookieDomainRewrite: { 'app.alpen.digital': '' },
                        },
                },
                watch: {
                        ignored: [
                                '**/.cache/**',
                                '**/node_modules/**',
                                '**/.wrangler/**',
                                '**/.git/**',
                                '**/.local/**',
                        ],
                },
        },

        // Clear cache more aggressively
        cacheDir: 'node_modules/.vite',
});

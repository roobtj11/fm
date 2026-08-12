import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { sites } from './build/sites-vite-plugin'

process.env.WRANGLER_WRITE_LOGS ??= 'false'
process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'
process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'

const { cloudflare } = await import('@cloudflare/vite-plugin')

export default defineConfig({
    plugins: [
        react(),
        sites(),
        cloudflare({
            config: {
                name: 'server',
                main: './worker/index.ts',
                compatibility_date: '2026-05-22',
                compatibility_flags: ['nodejs_compat'],
                assets: { not_found_handling: 'single-page-application' },
            },
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 3000,
        allowedHosts: true,
    },
    base: '/',
    environments: {
        server: {
            build: {
                rollupOptions: { output: { entryFileNames: 'index.js' } },
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                entryFileNames: `assets/[name].[hash].js`,
                chunkFileNames: `assets/[name].[hash].js`,
                assetFileNames: `assets/[name].[hash].[ext]`
            }
        }
    }
})

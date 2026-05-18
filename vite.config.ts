import { sentryVitePlugin } from '@sentry/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import fs from 'node:fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const appBase = '/cadam';
const normalizedAppBase = appBase.replace(/\/$/, '');

function serveOpenScadWasmInDev(): Plugin {
  return {
    name: 'serve-openscad-wasm-in-dev',
    configureServer(server) {
      const wasmPath = path.resolve(
        __dirname,
        'src/vendor/openscad-wasm/openscad.wasm',
      );

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        const url = new URL(req.url, 'http://localhost');
        if (
          url.pathname !==
          `${normalizedAppBase}/src/vendor/openscad-wasm/openscad.wasm`
        ) {
          return next();
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(wasmPath)
          .on('error', (error) => next(error))
          .pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: appBase,
  plugins: [
    serveOpenScadWasmInDev(),
    tanstackStart({
      router: {
        basepath: normalizedAppBase,
      },
      spa: {
        enabled: true,
        maskPath: normalizedAppBase,
      },
    }),
    react(),
    sentryVitePlugin({
      org: 'adamcad',
      project: 'adamcad',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,

    outDir: 'dist/cadam',
    emptyOutDir: true,

    sourcemap: true,
  },
  environments: {
    client: {
      build: {
        outDir: 'dist/cadam',
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (
                id.includes('/node_modules/react/') ||
                id.includes('/node_modules/react-dom/') ||
                id.includes('/node_modules/@tanstack/react-router/') ||
                id.includes('/node_modules/@tanstack/react-start/') ||
                id.includes('/node_modules/lucide-react/')
              ) {
                return 'vendor';
              }
            },
          },
        },
      },
    },
    server: {
      build: {
        outDir: 'dist/server',
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    exclude: ['@zip.js/zip.js', 'three', 'three-stdlib', '@sentry/vite-plugin'],
  },
});

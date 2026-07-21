import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          host: resolve(__dirname, 'src/preload/host.ts'),
          program: resolve(__dirname, 'src/preload/program.ts'),
        },
        // Sandboxed preloads cannot use ESM; emit CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/host'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/host/index.html') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
});

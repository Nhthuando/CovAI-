import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: [{ find: '@shared', replacement: fileURLToPath(new URL('./src/shared', import.meta.url)) }, { find: 'monaco-editor/esm', replacement: fileURLToPath(new URL('./node_modules/monaco-editor/esm', import.meta.url)) }] },
  plugins: [react(), tailwindcss()],
  // Worker imports must reach Vite's worker transform instead of becoming dependencies.
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: [
      'monaco-editor/esm/vs/editor/editor.worker.js?worker',
      'monaco-editor/esm/vs/language/json/json.worker.js?worker',
      'monaco-editor/esm/vs/language/css/css.worker.js?worker',
      'monaco-editor/esm/vs/language/html/html.worker.js?worker',
      'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker',
    ],
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('./', import.meta.url)), fileURLToPath(new URL('../shared', import.meta.url))] },
    watch: {
      usePolling: true,
      interval: 1500,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.cache/**",
        "**/coverage/**",
      ],
    },
    port: 5173,
    host: true,
    strictPort: true,
    hmr: {
      clientPort: 5173,
      overlay: true,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_DOCKER_URL || "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});

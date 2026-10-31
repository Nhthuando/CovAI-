import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
  server: {
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

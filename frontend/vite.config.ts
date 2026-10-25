import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { env } from "node:process";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": env.ROLEPILOT_API_TARGET ?? "http://127.0.0.1:8000" },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          table: ["@tanstack/react-table"],
        },
      },
    },
  },
  preview: { host: "127.0.0.1" },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", css: false },
});

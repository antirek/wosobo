import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 3120,
    host: "localhost",
    strictPort: true,
    proxy: {
      "/admin-api": {
        target: "http://127.0.0.1:3121",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/admin-api/, ""),
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/softphone/",
  plugins: [react()],
  server: {
    port: 3100,
    host: "localhost",
    strictPort: true,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One renderer bundle serves every window. The view is selected with the URL
// hash (#pet, #studio, #panel, #settings) so the app also loads from file://.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
  server: {
    port: 5317,
    strictPort: true,
  },
});

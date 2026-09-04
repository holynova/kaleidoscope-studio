import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_PAGES === "true" ? "/kaleidoscope-studio/" : "/",
  plugins: [react()],
  build: {
    outDir: process.env.VITE_PAGES === "true" ? "docs" : "dist",
    emptyOutDir: true,
  },
});

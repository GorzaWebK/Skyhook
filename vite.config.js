import { defineConfig } from 'vite';

// base './' so the build works from a GitHub Pages sub-path (/Skyhook/)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});

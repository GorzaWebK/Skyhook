import { defineConfig } from 'vite';

// base './' so the build works from a GitHub Pages sub-path (/New-game/)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});

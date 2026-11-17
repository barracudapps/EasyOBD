import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Relative base: the same build works in Tauri, on GitHub Pages and from a local folder.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});

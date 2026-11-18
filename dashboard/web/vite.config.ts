// Vite config for the dashboard frontend (root = web/). Build output: web/dist, served by the Fastify server.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Dev: the browser talks to Vite; /api goes to the dashboard backend (npm run dev).
    proxy: { '/api': 'http://127.0.0.1:3100' },
  },
});

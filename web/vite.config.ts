import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; in production Caddy serves both on one domain.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});

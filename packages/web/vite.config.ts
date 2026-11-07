import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// TAPTANA_MODE=http    el panel habla con /api/v1 (modo normal, servido por Hono en /sessions/)
// TAPTANA_MODE=static  el panel lee JSON incluidos en el sitio (GitHub Pages)
// TAPTANA_BASE         ruta base del sitio ('/sessions/' en el server, '/taptana/' en Pages)
const mode = process.env['TAPTANA_MODE'] === 'static' ? 'static' : 'http';
const base = process.env['TAPTANA_BASE'] ?? (mode === 'static' ? '/' : '/sessions/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  define: {
    __TAPTANA_MODE__: JSON.stringify(mode),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4321',
      '/__taptana': 'http://localhost:4321',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});

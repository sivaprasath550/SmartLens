import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// In development the dashboard calls same-origin /api and /socket.io, and
// Vite proxies them to the backend. This avoids CORS issues and means the
// dashboard also works when opened from another device on the LAN.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_DEV_BACKEND_URL || 'http://localhost:3000';
  // Browsers send an Origin header on same-origin POST/DELETE requests. The
  // proxy is the real client of the backend, so drop it; otherwise opening the
  // dashboard via a LAN IP or another port would trip the backend CORS check.
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: backend,
      configure: (p) => p.on('proxyReq', (req) => req.removeHeader('origin')),
    },
    '/socket.io': {
      target: backend,
      ws: true,
      configure: (p) => {
        p.on('proxyReq', (req) => req.removeHeader('origin'));
        p.on('proxyReqWs', (req) => req.removeHeader('origin'));
      },
    },
  };
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy,
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 700,
    },
  };
});

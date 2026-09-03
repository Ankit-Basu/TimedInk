import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    /**
     * Proxy /api to the backend in dev. This keeps the browser on a single
     * origin, so there is no CORS preflight on every dashboard poll and the app
     * works unchanged if it is later served from behind the same reverse proxy.
     * VITE_API_BASE_URL overrides it if you'd rather hit the API directly.
     */
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Split the framework out of the app chunk. React, the router and the
         * query client change only when a dependency is bumped, while app code
         * changes constantly — separating them means a redeploy only
         * invalidates the small chunk, not the 250KB one.
         */
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});

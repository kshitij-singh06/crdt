import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow the Yjs WebSocket provider to connect directly to ws://localhost:4001
    // without going through the Vite dev proxy (which doesn't forward WS upgrades
    // for arbitrary ports). REST calls go directly to http://localhost:4000 too,
    // which is fine as long as the backend has CORS enabled (which it does via the
    // `cors` package in index.js).
  },
})

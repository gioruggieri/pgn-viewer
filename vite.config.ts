// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',   // bind esplicito IPv4
    port: 5174,          // usa una porta diversa dalla 5173
    strictPort: true,    // se occupata, fallisce invece di cambiare porta
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
})


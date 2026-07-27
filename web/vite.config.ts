import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: { port: 3100, strictPort: true },
  preview: { port: 8100, strictPort: true },
  worker: { format: 'es' },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Gastos Alba — PWA mobile-first.
// El service worker y el manifest viven en /public y se sirven tal cual:
// no usamos plugin de PWA para mantener el bundle y las dependencias al minimo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    sourcemap: false,
  },
})

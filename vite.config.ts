import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Общая с mobile/ логика погоды и маршрута.
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})

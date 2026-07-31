import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // host: true so the phone on the same wifi can hit it. Milestone 1 is a
  // hand-feel test; it cannot be judged on a desktop trackpad.
  server: { host: true, port: 5180 },
})

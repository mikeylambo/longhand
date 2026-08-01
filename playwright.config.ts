import { defineConfig } from '@playwright/test'

const PORT = 5181

export default defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    // A port of its own, so a running dev server isn't disturbed by a test run.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/?selftest=1`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})

import { readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const PORT = 5181

// The ledger specs talk to the real Supabase endpoint, so they need the same
// credentials the app uses. Loaded here rather than required in the shell, and
// absent credentials skip those specs instead of failing them.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 1 || line.trimStart().startsWith('#')) continue
    const key = line.slice(0, eq).trim()
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim()
  }
} catch {
  /* no .env.local — ledger specs will skip */
}

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

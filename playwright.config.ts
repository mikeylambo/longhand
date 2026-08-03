import { readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const PORT = 5181

// .env.local carries the app's own credentials; .env.test.local carries the
// throwaway project the database specs are allowed to write to. Both are
// loaded because tests/support/ledger.ts compares them — pointing the tests at
// whatever the app is pointed at is one of the mistakes it refuses.
function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 1 || line.trimStart().startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim()
    }
  } catch {
    /* absent is fine here — the specs themselves decide what they require */
  }
}

loadEnv('.env.local')
loadEnv('.env.test.local')

export default defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  // Split so the database-backed specs are an explicit choice. `test:app` is
  // everything that needs nothing but a browser; `test:ledger` needs the
  // throwaway project and fails loudly without it.
  projects: [
    { name: 'app', testIgnore: /ledger\.spec\.ts/ },
    { name: 'ledger', testMatch: /ledger\.spec\.ts/ },
  ],
  webServer: {
    // A port of its own, so a running dev server isn't disturbed by a test run.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/?selftest=1`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})

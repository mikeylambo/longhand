/**
 * Credentials for the specs that talk to a real database.
 *
 * The archive is append-only: a layer written by a stray test run cannot be
 * deleted, only hidden, and a hidden row is still a row in a permanent record.
 * So the test suite gets its own throwaway project and is not merely *asked*
 * to use it — it is prevented from reaching anything else.
 *
 * Three guards, in order of how likely each is to save you:
 *
 *   1. TEST_SUPABASE_* must be set. Missing credentials fail the run loudly
 *      rather than skipping it, because a skipped safety test reads as green.
 *   2. The URL is checked against the refs below. A production ref is refused
 *      outright no matter which variable it arrived in.
 *   3. If the app's own VITE_SUPABASE_URL is present and identical, that is a
 *      copy-paste into the wrong file, and it is refused too.
 *
 * A project ref is not a secret — it ships in the client bundle — so listing
 * the live one here costs nothing and makes the rule impossible to misread.
 *
 * None of this cares *where* the throwaway is. A local `supabase start` at
 * 127.0.0.1 satisfies all three guards, costs nothing, and cannot be production
 * by construction — which makes it the better answer than a second cloud
 * project, not the fallback.
 */

/** Never writable by a test, whatever the environment says. */
const PROTECTED_REFS = [
  'uxlhgbvhmukfrhtzzifu', // longhand — the live archive
  'rzpjciflydbkpxcimdhb', // SIGNAL
]

const SETUP = `
Point these specs at a throwaway database in .env.test.local.

Easiest, and free:

  supabase start                      # needs Docker
  TEST_SUPABASE_URL=http://127.0.0.1:54321
  TEST_SUPABASE_PUBLISHABLE_KEY=<the anon key supabase start prints>

Or a second cloud project, if you cannot run Docker. Either way apply
supabase/migrations/*.sql in order. See .env.test.example.
`.trim()

export interface Ledger {
  url: string
  key: string
  headers: Record<string, string>
}

export function ledgerEnv(): Ledger {
  const url = process.env.TEST_SUPABASE_URL?.trim()
  const key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !key) {
    throw new Error(
      `These tests write to a database and no throwaway project is configured, ` +
        `so they will not run.\n\n${SETUP}`,
    )
  }

  const hit = PROTECTED_REFS.find((ref) => url.includes(ref))
  if (hit) {
    throw new Error(
      `TEST_SUPABASE_URL points at ${hit}, which is a protected project. ` +
        `The test suite must never be able to write to a live archive — its ` +
        `layers are append-only and cannot be removed afterwards.`,
    )
  }

  const app = process.env.VITE_SUPABASE_URL?.trim()
  if (app && app === url) {
    throw new Error(
      `TEST_SUPABASE_URL is the same as VITE_SUPABASE_URL. The tests would be ` +
        `writing to whatever the app is pointed at.\n\n${SETUP}`,
    )
  }

  return {
    url,
    key,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  }
}

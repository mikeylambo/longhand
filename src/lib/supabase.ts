import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * With no credentials the app runs entirely in the browser: the twelve-slot
 * relay is faked locally and nothing is written anywhere. That keeps a build
 * deployable and testable for hand-feel work without a database behind it.
 * Set both env vars and the same UI writes to the real ledger instead.
 */
export const LEDGER_ENABLED = Boolean(url && key)

export const supabase: SupabaseClient | null = LEDGER_ENABLED
  ? createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('ledger is disabled: no Supabase credentials')
  return supabase
}

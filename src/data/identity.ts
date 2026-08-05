import { requireSupabase } from '../lib/supabase'
import { cachedSignatureId, deviceKey } from './ledger'

/**
 * The mark, made portable.
 *
 * The device key has been a bearer token in local storage since milestone 2:
 * clearing it loses your mark, copying it takes your mark. That was an honest
 * trade while nothing was ever *sent* to anybody. It stops being one the moment
 * a notification says a canvas you drew on has closed, because "you" then has
 * to survive a browser update.
 *
 * A recovery key is the smallest thing that fixes it without becoming an
 * account. It is minted by the server, shown once, and stored only as a digest.
 * It identifies nobody, it cannot be reset because there is no email to reset
 * it with, and it is the one credential this product has.
 */

const KEY = 'longhand.recovery.v1'

/** The key is kept locally too, so the screen that offers it can keep offering
 *  it. Somebody who dismisses it once should not have to mint a second. */
export function storedRecoveryKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export async function mintRecoveryKey(): Promise<string> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('there is no mark on this browser yet')

  const db = requireSupabase()
  const { data, error } = await db.rpc('mint_recovery_key', {
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not make you a key: ${error.message}`)

  const key = data as string
  try {
    localStorage.setItem(KEY, key)
  } catch {
    /* private mode — they still have it on screen, which is the point */
  }
  return key
}

/** Shape-checks before spending a round trip on an obvious typo. */
export const looksLikeRecoveryKey = (s: string) =>
  /^lh-[0-9a-f]{5}(-[0-9a-f]{5}){5}$/i.test(s.trim())

export async function redeemRecoveryKey(key: string): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('redeem_recovery_key', {
    p_key: key.trim().toLowerCase(),
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`that key did not work: ${error.message}`)

  const signatureId = data as string
  localStorage.setItem('longhand.signature-id.v1', signatureId)
  try {
    localStorage.setItem(KEY, key.trim().toLowerCase())
  } catch {
    /* ignore */
  }
  return signatureId
}

// ------------------------------------------------------------------- push

/**
 * The base64url VAPID public key, as a Uint8Array.
 *
 * Set `VITE_VAPID_PUBLIC_KEY` and notifications become available; leave it
 * unset and every path here returns "unsupported", which is what a build with
 * no push infrastructure behind it should say rather than failing at the
 * moment somebody taps.
 */
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  // Built on its own ArrayBuffer rather than with Uint8Array.from, so the type
  // is the plain-ArrayBuffer view PushManager asks for.
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export const pushSupported = () =>
  Boolean(VAPID) &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window

export async function pushState(): Promise<'off' | 'on' | 'blocked' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/**
 * Asks, subscribes, and tells the ledger which mark to reach.
 *
 * The permission prompt is only ever raised from a tap — never on load, never
 * on the welcome screen. A browser that is asked cold says no once and means it
 * forever, which would cost the return hook permanently for a moment of
 * impatience.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('there is no mark on this browser yet')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID!),
    }))

  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> }
  const db = requireSupabase()
  const { error } = await db.rpc('subscribe_push', {
    p_signature: signatureId,
    p_device_key: deviceKey(),
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })
  if (error) throw new Error(`could not turn those on: ${error.message}`)
  return true
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  try {
    await requireSupabase().rpc('unsubscribe_push', { p_endpoint: endpoint })
  } catch {
    // The browser has already stopped delivering. A row left behind is tidied
    // by the sender the first time the push service says the endpoint is gone.
  }
}

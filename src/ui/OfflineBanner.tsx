import { useEffect, useState } from 'react'

/**
 * A quiet strip that says the connection has dropped.
 *
 * The app leans on the network at exactly two moments — claiming a slot and
 * submitting a turn — and both fail in ways that are confusing without a word
 * of explanation: a Finish that does nothing, a sheet that will not load. The
 * draft is saved locally through all of it, so nothing is actually lost; this
 * just names why the thing they tapped did not happen.
 *
 * `navigator.onLine` is the browser's own answer and an imperfect one — it
 * knows there is an interface, not that anything is reachable — but it is the
 * signal the `online`/`offline` events fire on, and being slightly optimistic
 * is the right failure here: a banner that cried wolf would be worse than one
 * that occasionally misses a dead-but-connected network, which the two real
 * network calls surface on their own anyway.
 *
 * Mounted once, above every route, so it is not a thing each screen has to
 * remember to carry.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync() // in case it changed between first paint and this effect
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  if (!offline) return null

  return (
    <div className="offline" role="status">
      You’re offline — reconnect to keep drawing and saving.
    </div>
  )
}

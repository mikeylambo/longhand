/**
 * What the splash is waiting for.
 *
 * The splash used to come down on a timer alone: a floor of about a second and
 * a half from the moment the bundle ran, and then off, whatever was behind it.
 * On this machine that is always fine — the welcome screen has painted inside
 * three hundred milliseconds — and it survives a twelvefold CPU throttle,
 * because everything that slows the mount slows the timer with it.
 *
 * The case it does not survive is the one that matters most in an installed
 * app: the shell comes off the service worker instantly, the hand is already
 * signed, so booting means one round trip to the relay to be given a slot. On
 * a bad connection that round trip outlasts the floor, the splash lifts, and
 * what it uncovers is `Finding you a sheet…` — a second loading screen behind
 * the first one. Two waits where there should be one.
 *
 * So a screen that knows it is not ready yet says so, and the splash stays up
 * until it is. The floor still applies (a wordmark that flashes past reads as
 * a glitch), and so does a ceiling, because a relay that never answers must
 * not be able to trap anybody behind a logo — past that point the loading
 * screen is the honest thing to show.
 *
 * Holds are keyed rather than counted so that a screen can call this on every
 * render with the answer to one question — am I ready — instead of having to
 * pair up acquisitions and releases.
 */

const holds = new Set<string>()
let listeners = new Set<() => void>()

/** Declare whether `key` is still waiting on something. Idempotent. */
export function holdSplash(key: string, held: boolean): void {
  const before = holds.size
  if (held) holds.add(key)
  else holds.delete(key)
  if (before > 0 && holds.size === 0) {
    // Taken before firing: a listener that re-enters would otherwise be
    // iterating the set it is mutating.
    const waiting = listeners
    listeners = new Set()
    for (const l of waiting) l()
  }
}

/**
 * Run `cb` once nothing is holding — immediately, if nothing is.
 *
 * One-shot, and there is no unsubscribe, because the only caller is the
 * handover itself and it happens exactly once per page.
 */
export function whenSplashClear(cb: () => void): void {
  if (holds.size === 0) cb()
  else listeners.add(cb)
}

/** For tests. */
export function splashHolds(): string[] {
  return [...holds]
}

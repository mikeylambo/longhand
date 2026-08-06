import { flushSync } from 'react-dom'

/**
 * Screen changes crossfade instead of cutting.
 *
 * flushSync is required: startViewTransition snapshots the DOM, runs the
 * callback, then snapshots again, so React has to commit synchronously inside
 * it or the transition captures the same frame twice and does nothing.
 * Browsers without the API just get the old hard cut.
 *
 * Lived in App.tsx until the router needed it too. Moving between sections is
 * the same kind of event as moving between phases of a turn — and it is the
 * one that used to be a full page load, so it is the one with the most to
 * gain from not looking like a document being replaced.
 */
type WithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> }
}

export function transition(update: () => void): void {
  const d = document as WithVT
  if (!d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  d.startViewTransition(() => flushSync(update))
}

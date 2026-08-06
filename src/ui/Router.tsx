import { useEffect, useState, type ReactNode } from 'react'
import { transition } from './transition'

/**
 * Moving around without leaving.
 *
 * Every screen used to be a plain anchor and a full document load. That was a
 * defensible choice while each route was somewhere you *arrived* at — a shared
 * link, a notification — and it stops being one the moment somebody uses this
 * for an hour. Every tap threw away the bundle, remounted React and re-booted
 * the session, which is the beat of nothing that makes a thing read as a
 * website rather than an app.
 *
 * It also, since the splash landed, replayed the splash on every navigation.
 * A wordmark that says "opening" on launch says "broken" on the fourth tap in
 * a minute.
 *
 * What this deliberately is not is a routing library. The URLs do not change,
 * the markup stays plain anchors, and arriving from outside still loads that
 * route directly — so a shared `/c/<id>` behaves exactly as it did, and so does
 * a browser with no JavaScript. All this adds is: when the app is already
 * running, do not throw it away to move one screen.
 */

/** Clicks this cannot claim, because the browser owes them its own behaviour. */
function isPlainLeftClick(e: MouseEvent): boolean {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.defaultPrevented
  )
}

/**
 * Whether this app can serve the href itself.
 *
 * Same origin only, and no `target`, `download` or `rel=external` — each of
 * those is somebody asking for the browser's behaviour rather than ours. A
 * fragment on the current page is left alone so anchors still jump.
 */
function internalPath(a: HTMLAnchorElement): string | null {
  if (a.target && a.target !== '_self') return null
  if (a.hasAttribute('download')) return null
  if (a.getAttribute('rel')?.split(/\s+/).includes('external')) return null

  const href = a.getAttribute('href')
  if (!href || href.startsWith('#')) return null

  let url: URL
  try {
    url = new URL(a.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  return url.pathname + url.search + url.hash
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search + window.location.hash) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Renders whatever `render` makes of the current location, and re-renders it
 * when the location changes.
 *
 * The listener is on the document rather than on each link because links are
 * written all over the app as ordinary anchors, and they should stay that way
 * — a component that had to be imported to navigate would be a rule everyone
 * has to remember, and the one place it was forgotten would be a full reload
 * nobody could explain.
 */
export function Router({ render }: { render: (path: string) => ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => {
      // The same crossfade the phases of a turn use. Without it a section
      // change is a hard cut, which is the other half of why a full page load
      // read as a document being replaced rather than an app moving.
      transition(() => {
        setPath(window.location.pathname)
        // Arriving at a screen should show its top, the way a fresh load does.
        // Left to itself the browser keeps the scroll position of the screen
        // being left, which reads as the new screen having started halfway
        // down. Inside the transition so it is part of the snapshot rather
        // than a jump after it.
        window.scrollTo(0, 0)
      })
    }

    const onClick = (e: MouseEvent) => {
      if (!isPlainLeftClick(e)) return
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      const to = internalPath(a as HTMLAnchorElement)
      if (to === null) return
      e.preventDefault()
      navigate(to)
    }

    window.addEventListener('popstate', onPop)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('click', onClick)
    }
  }, [])

  return <>{render(path)}</>
}

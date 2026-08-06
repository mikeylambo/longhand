import { DrawTabIcon, GalleryTabIcon, MarkTabIcon, WorldTabIcon } from './icons'

/**
 * Where you can go, at the bottom, always.
 *
 * The footer this replaces was a row of small grey text links, which is what a
 * website puts at the bottom of a page. A bar at thumb height with a mark and
 * a word per destination is what an app puts there, and the difference is most
 * of why this read as a site.
 *
 * Four, because four fits across a small phone without shrinking the targets
 * and because there are exactly four places worth standing. Terms and safety
 * are not destinations — they are promises, and they keep the quiet line under
 * the bar rather than a tab of their own.
 *
 * Not shown while drawing. That screen is the sheet edge to edge with the tool
 * tray already at the bottom, and offering three ways to leave in the middle
 * of a ten-minute turn is the opposite of what it needs.
 */

const TABS = [
  { href: '/', label: 'Draw', Icon: DrawTabIcon },
  { href: '/gallery', label: 'Gallery', Icon: GalleryTabIcon },
  { href: '/world', label: 'World', Icon: WorldTabIcon },
  { href: '/mark', label: 'You', Icon: MarkTabIcon },
]

/** `/` would otherwise match everything; a trailing slash should not stop a
 *  screen recognising itself. */
function isHere(here: string, href: string): boolean {
  const trim = (s: string) => (s.length > 1 ? s.replace(/\/+$/, '') : s)
  return trim(here) === trim(href)
}

export function TabBar() {
  const here = typeof window === 'undefined' ? '/' : window.location.pathname

  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map(({ href, label, Icon }) => {
        const current = isHere(here, href)
        return (
          <a
            key={href}
            href={href}
            className={`tab${current ? ' on' : ''}`}
            aria-current={current ? 'page' : undefined}
          >
            <Icon />
            <span>{label}</span>
          </a>
        )
      })}
    </nav>
  )
}

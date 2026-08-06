import { Fragment } from 'react'

/**
 * The quiet row at the bottom of every screen that isn't the sheet.
 *
 * Terms have to be reachable from wherever somebody is standing when they
 * wonder about them, and the safety position has to be reachable by a parent
 * who has never drawn anything here. Small, grey, and out of the way of the
 * one thing each screen is asking for.
 *
 * Two things were wrong with the first version, and they had the same cause:
 * the row was built by hiding links rather than by marking where you are.
 *
 * Nothing linked to `/`. Every other screen was reachable from every screen,
 * and the one that actually does something — find a sheet, take a turn — was
 * reachable only by editing the address bar. A museum with no way back to the
 * studio.
 *
 * And `gallery` was passed by every caller *except* the gallery and the world,
 * which is exactly backwards. It meant that standing in the gallery you could
 * not reach the world, and standing in the world you could not reach the
 * gallery: the two screens most obviously paired were the two that could not
 * see each other.
 *
 * So the set no longer changes with where you are. The current screen is
 * marked instead of removed, which keeps the row the same width everywhere and
 * tells a screen reader which one it is. The prop is now about attention
 * rather than place — see `wander`.
 */

/** Places to go. Only shown when wandering off is a reasonable thing to do. */
const PLACES = [
  { href: '/', label: 'Add yours' },
  { href: '/gallery', label: 'The gallery' },
  { href: '/world', label: 'The world' },
]

/** Always reachable. Terms and safety are promises, not destinations. */
const ALWAYS = [
  { href: '/mark', label: 'Your mark' },
  { href: '/terms', label: 'Terms' },
  { href: '/safety', label: 'Safety' },
]

export function Footer({ wander = false }: { wander?: boolean }) {
  // False on the signature pad and mid-turn: somebody being asked for one
  // thing should not be offered three ways to leave. That was the real intent
  // behind the old `gallery` flag, and it is the only case that needs it.
  const items = wander ? [...PLACES, ...ALWAYS] : ALWAYS

  // Read at render rather than held in state: every link here is a plain
  // anchor, so arriving anywhere is a fresh document and this is read once
  // with the right answer.
  const here = typeof window === 'undefined' ? '' : window.location.pathname

  return (
    <nav className="footer">
      {items.map((item, i) => (
        <Fragment key={item.href}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {isHere(here, item.href) ? (
            <span className="footer-here" aria-current="page">
              {item.label}
            </span>
          ) : (
            <a href={item.href}>{item.label}</a>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

/**
 * `/` would otherwise match everything, and a trailing slash should not make a
 * screen fail to recognise itself.
 */
function isHere(here: string, href: string): boolean {
  const trim = (s: string) => (s.length > 1 ? s.replace(/\/+$/, '') : s)
  return trim(here) === trim(href)
}

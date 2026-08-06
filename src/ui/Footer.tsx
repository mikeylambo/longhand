import { TabBar } from './TabBar'

/**
 * The bottom of every screen that isn't the sheet.
 *
 * Two rows now, and the split is the point. The tab bar is where you can *go*
 * — four destinations, thumb height, the current one lit. Underneath it, small
 * and grey, the two things that are not destinations at all: the terms and the
 * position on young people. Those have to be reachable from wherever somebody
 * is standing when they wonder about them, and a parent who has never drawn
 * anything has to be able to find the second one — but neither is a place you
 * visit, so neither gets a tab.
 *
 * This used to be one row of grey links including the destinations, which is
 * how a website ends a page. It read like one.
 *
 * `wander` false — the signature pad, mid-turn — drops the tab bar and keeps
 * the promises. Somebody being asked for one thing should not be offered four
 * ways to leave, and the terms are exactly what they might want to check
 * before signing.
 */
export function Footer({ wander = false }: { wander?: boolean }) {
  return (
    <>
      {wander && <TabBar />}
      <nav className={`footer${wander ? ' under-tabs' : ''}`}>
        <a href="/terms">Terms</a>
        <span aria-hidden="true">·</span>
        <a href="/safety">Safety</a>
      </nav>
    </>
  )
}

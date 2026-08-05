/**
 * The quiet row at the bottom of every screen that isn't the sheet.
 *
 * Terms have to be reachable from wherever somebody is standing when they
 * wonder about them, and the safety position has to be reachable by a parent
 * who has never drawn anything here. Small, grey, and out of the way of the
 * one thing each screen is asking for.
 */
export function Footer({ gallery = false }: { gallery?: boolean }) {
  return (
    <nav className="footer">
      {gallery && (
        <>
          <a href="/gallery">The gallery</a>
          <span aria-hidden="true">·</span>
        </>
      )}
      <a href="/terms">Terms</a>
      <span aria-hidden="true">·</span>
      <a href="/safety">Safety</a>
    </nav>
  )
}

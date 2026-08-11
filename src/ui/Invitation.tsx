import { formatFor } from '../config'
import type { GiftPeek } from '../data/ledger'
import { Footer } from './Footer'

/**
 * Somebody saved you a place.
 *
 * The only screen in the product that begins with a fact about another person,
 * and it does not name them — a gift is between two people and the ledger is
 * not one of them. Whoever sent the link knows what they sent; nobody else
 * needs to be told, and putting a name here would be the first step toward
 * this being a social network.
 */
export function Invitation({
  gift,
  hasMark,
  onAccept,
}: {
  gift: GiftPeek
  hasMark: boolean
  onAccept: () => void
}) {
  const format = formatFor(gift.slot_count)
  const hours = Math.max(
    1,
    Math.round((Date.parse(gift.expires_at) - Date.now()) / 3_600_000),
  )

  return (
    <div className="panel">
      <h1>A place was saved for you</h1>
      <p>
        Slot {gift.slot} of {gift.slot_count} on “{gift.seed}” — {format.name},
        and this one is being held. Nobody else can take it.
      </p>

      <div className="scroll">
        <dl className="promises">
          <dt>Permanent ink</dt>
          <dd>
            Every stroke matters. You can always add to the drawing, but you can
            never erase — so embrace the happy accidents.
          </dd>
          <dt>Ten minutes, once you start</dt>
          <dd>
            The clock does not begin until you do. The place is held for about{' '}
            {hours} {hours === 1 ? 'hour' : 'hours'} and then goes back to the
            pool.
          </dd>
          {!hasMark && (
            <>
              <dt>You sign first</dt>
              <dd>
                By hand, once. It is the only name here and it is how your work
                gets credited — there is no username, and no way to write one.
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className="row">
        <a className="linkbtn quiet" href={`/c/${gift.canvas}`}>
          Look at it first
        </a>
        <div className="spacer" />
        <button className="linkbtn solid" onClick={onAccept}>
          {hasMark ? 'Take the place' : 'Sign, and take it'}
        </button>
      </div>

      <Footer wander />
    </div>
  )
}

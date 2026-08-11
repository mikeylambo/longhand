import { useEffect, useState } from 'react'
import { fetchCanvasInProgress } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { WelcomeReel } from './WelcomeReel'
import { Footer } from './Footer'

interface Props {
  onStart: () => void
}

const KEY = 'longhand.welcomed.v1'

export function seenWelcome(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* private mode — they will see it again, which is the harmless failure */
  }
}

/**
 * The first screen, once.
 *
 * One screen, deliberately. No tutorial, no carousel, no dismissible tips
 * layered over the sheet: if it takes more than this, the product is the
 * problem and a longer explanation only hides it.
 *
 * It has one reader and it is two people at once: a child who has picked up a
 * parent's phone, and someone who found this on purpose. Both have to feel
 * welcome, so the words are concrete and short enough for the first and never
 * so cute they talk down to the second. The clip does the real teaching —
 * a drawing building itself needs no reading age — and the words only have to
 * stay out of its way and answer, plainly, the three things anyone wonders
 * before they will draw: what is this, can my part be ruined, and how long is
 * a turn. "Strangers" and "slots" and "the pool" are gone; a picture made by
 * lots of hands is a thing an eight-year-old can already see.
 */
export function Welcome({ onStart }: Props) {
  const [progress, setProgress] = useState<string | null>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) return
    let alive = true
    fetchCanvasInProgress()
      .then((c) => {
        if (!alive) return
        setProgress(
          c
            ? `${c.slots_filled} of ${c.slot_count} hands are already on the sheet you would join.`
            : 'No drawing is half-finished right now — so you would start a fresh one, and someone else would find it.',
        )
      })
      .catch(() => {
        /* a line about how busy it is must never be the reason nobody draws */
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="panel welcome">
      <div className="scroll">
        <WelcomeReel />

        <h1>One drawing, lots of hands</h1>
        <p>
          You add a little, then it is someone else&rsquo;s turn. When the last
          hand finishes, the drawing is done — and it stays that way for good.
        </p>

        <dl className="promises">
          <dt>Nothing rubs out</dt>
          <dd>
            Your part stays, and so does everyone else&rsquo;s. You can add to
            the drawing, but you can never rub any of it out.
          </dd>
          <dt>Ten minutes</dt>
          <dd>
            Your turn lasts ten minutes — time to think, not a race. Stop early
            and it passes to whoever is next.
          </dd>
        </dl>

        {progress && <p className="stat">{progress}</p>}
      </div>

      <div className="row">
        <div className="spacer" />
        <button className="linkbtn solid" onClick={onStart}>
          Add yours
        </button>
      </div>

      <Footer wander />
    </div>
  )
}

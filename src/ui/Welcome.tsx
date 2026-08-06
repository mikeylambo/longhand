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
 * Everything here answers a question a stranger has before they will draw.
 * The clip answers "what is this". The ink line answers "can somebody ruin
 * what I make" — stated as a promise before they draw rather than as a warning
 * after they try. The count answers "is anyone else here". The clock line
 * answers "how much of my afternoon is this", once, gently, so that ten
 * minutes reads as room to think rather than as a countdown.
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
            : 'Nothing is part-finished right now, so you would open a sheet and somebody else would find it.',
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

        <h1>One sheet, passed between strangers</h1>
        <p>
          You take a slot on a drawing somebody else started, and somebody else
          will finish. When the last hand lands it closes for good.
        </p>

        <dl className="promises">
          <dt>Ink only</dt>
          <dd>
            Nothing you add can be removed — and nothing you add can remove
            anyone else&rsquo;s.
          </dd>
          <dt>Ten minutes</dt>
          <dd>
            Room to think, not a countdown. Leave without finishing and the slot
            quietly goes back to the pool.
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

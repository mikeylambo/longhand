import { useEffect, useRef, useState } from 'react'
import { Surface } from '../engine/surface'
import {
  SIGNATURE_COLOR,
  SIGNATURE_H,
  SIGNATURE_INK,
  SIGNATURE_W,
  SIGNATURE_WIDTH,
  TUNING,
} from '../config'
import type { Stroke } from '../engine/types'
import { Footer } from './Footer'

interface Props {
  /** Persistence is the session's job — local mode keeps it in the browser,
   *  ledger mode also writes it to `signatures`. */
  onDone: (strokes: Stroke[]) => void
}

/**
 * Identity is a drawn mark. No username, no avatar, no account — so this is the
 * only sign-up screen the product will ever have.
 */
export function SignaturePad({ onDone }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<Surface | null>(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const s = new Surface(host, {
      width: SIGNATURE_W,
      height: SIGNATURE_H,
      tuning: { ...TUNING, inkBudget: SIGNATURE_INK },
      inkBudget: SIGNATURE_INK,
      fixedColor: SIGNATURE_COLOR,
      fixedWidth: SIGNATURE_WIDTH,
      allowGestures: false,
      fitPad: 1,
      onStrokes: setCount,
    })
    surfaceRef.current = s
    return () => {
      surfaceRef.current = null
      s.destroy()
    }
  }, [])

  return (
    <div className="panel">
      <h1>Your mark</h1>
      {/* A form asks you for something before it lets you in; this looks like
          one and is the opposite of one. So it leads with the doing — draw a
          squiggle — and only then says what the squiggle is for, because a
          child will scribble happily and read nothing, and that is the right
          instinct here. The mark is the whole identity: it is how a part of a
          drawing gets known as yours, and it asks nothing about who you are. */}
      <p>Draw your mark — your initials, a squiggle, any shape you like.</p>
      <p className="stat">
        It goes on everything you draw here, so people can tell which parts are
        yours. No username, nothing to spell — your mark is your name, and it is
        not asking who you are.
      </p>

      <div className="sigbox" ref={hostRef}>
        <div className="sigline" />
        {/* A child needs to know the box is theirs to draw in. Gone the instant
            the first stroke lands, and never in the way of it. */}
        {count === 0 && <span className="sighint">draw here</span>}
      </div>

      {/* The actions belong at the bottom of the screen, not floating under
          the box with three hundred pixels of nothing beneath them. */}
      <div className="spacer" />

      <div className="row">
        <button
          className="linkbtn"
          disabled={count === 0}
          onClick={() => surfaceRef.current?.clearTurn()}
        >
          Start over
        </button>
        <div className="spacer" />
        <button
          className="linkbtn solid"
          disabled={count === 0}
          onClick={() => {
            const layer = surfaceRef.current?.getLayer() ?? []
            if (layer.length === 0) return
            onDone(layer)
          }}
        >
          This is my mark
        </button>
      </div>

      <Footer />
    </div>
  )
}

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
      {/* This screen used to sit between a stranger and drawing with no
          explanation of why it was there, which made it feel like a form. It
          is the opposite of a form: it is the only identity this product has,
          and it is how anything you make gets credited to you. */}
      <p>
        Sign once, by hand. It goes on the back of every canvas you draw on and
        it is the only name you get — there is no username here, and no way to
        write one.
      </p>
      <p className="stat">
        Anything at all: initials, a squiggle, a shape. Nobody is checking it
        against anything, and it is not asking who you are.
      </p>

      <div className="sigbox" ref={hostRef}>
        <div className="sigline" />
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

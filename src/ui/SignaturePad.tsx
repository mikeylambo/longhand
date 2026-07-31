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
import { saveSignature } from '../store'

interface Props {
  onDone: () => void
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
      <p>
        Sign once. It travels with everything you draw and it is the only name
        you get — there is no username here, and no way to write one.
      </p>

      <div className="sigbox" ref={hostRef}>
        <div className="sigline" />
      </div>

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
            saveSignature(layer)
            onDone()
          }}
        >
          This is my mark
        </button>
      </div>
    </div>
  )
}

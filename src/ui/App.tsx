import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Stroke } from '../engine/types'
import { createSession, type CanvasState } from '../data/session'
import { loadSignature, type StoredSignature } from '../store'
import { SignaturePad } from './SignaturePad'
import { DrawTurn } from './DrawTurn'
import { Review } from './Review'

type Phase = 'loading' | 'signature' | 'draw' | 'review' | 'error'

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'something went wrong'

/**
 * Screen changes crossfade instead of cutting.
 *
 * flushSync is required: startViewTransition snapshots the DOM, runs the
 * callback, then snapshots again, so React has to commit synchronously inside
 * it or the transition captures the same frame twice and does nothing.
 * Browsers without the API just get the old hard cut.
 */
type WithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> }
}

function transition(update: () => void): void {
  const d = document as WithVT
  if (!d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  d.startViewTransition(() => flushSync(update))
}

export function App() {
  const [session] = useState(createSession)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<CanvasState | null>(null)
  const [justDrawn, setJustDrawn] = useState<Stroke[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signature, setSignature] = useState<StoredSignature | null>(() =>
    loadSignature(),
  )

  const boot = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      if (!session.hasSignature()) {
        setPhase('signature')
        return
      }
      const joined = await session.join()
      transition(() => {
        setCanvas(joined)
        setPhase('draw')
      })
    } catch (e) {
      setError(message(e))
      setPhase('error')
    }
  }, [session])

  useEffect(() => {
    void boot()
  }, [boot])

  if (phase === 'loading') {
    return (
      <div className="panel center">
        <p className="stat">Finding you a sheet…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="panel center">
        <h1>Not now</h1>
        <p>{error}</p>
        <div className="row">
          <button className="linkbtn solid" onClick={() => void boot()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'signature') {
    return (
      <SignaturePad
        onDone={async (strokes) => {
          setPhase('loading')
          try {
            await session.registerSignature(strokes)
            const joined = await session.join()
            transition(() => {
              setSignature(loadSignature())
              setCanvas(joined)
              setPhase('draw')
            })
          } catch (e) {
            setError(message(e))
            setPhase('error')
          }
        }}
      />
    )
  }

  if (!canvas) return null

  if (phase === 'review') {
    return (
      <Review
        canvas={canvas}
        layer={justDrawn}
        signature={signature}
        mode={session.mode}
        onNext={async () => {
          setPhase('loading')
          try {
            setCanvas(
              canvas.closed ? await session.nextCanvas() : await session.join(),
            )
            setJustDrawn([])
            setPhase('draw')
          } catch (e) {
            setError(message(e))
            setPhase('error')
          }
        }}
      />
    )
  }

  return (
    <DrawTurn
      key={`${canvas.turnId ?? canvas.canvasId ?? canvas.seed}-${canvas.slot}`}
      seed={canvas.seed}
      slot={canvas.slot}
      palette={canvas.palette}
      priorLayers={canvas.priorLayers}
      width={canvas.width}
      height={canvas.height}
      expiresAt={canvas.expiresAt}
      onExpired={async () => {
        setPhase('loading')
        try {
          const next = await session.nextCanvas()
          transition(() => {
            setCanvas(next)
            setPhase('draw')
          })
        } catch (e) {
          setError(message(e))
          setPhase('error')
        }
      }}
      submitting={submitting}
      submitError={submitError}
      onDismissError={() => setSubmitError(null)}
      onSubmit={async (layer) => {
        // Deliberately stays on the drawing screen. Swapping to a loading or
        // error phase unmounts the surface, and a failed save would then have
        // thrown away a turn's work over something as ordinary as a dropped
        // connection.
        setSubmitting(true)
        setSubmitError(null)
        try {
          const next = await session.submit(layer)
          transition(() => {
            setJustDrawn(layer)
            setCanvas(next)
            setPhase('review')
          })
        } catch (e) {
          setSubmitError(message(e))
        } finally {
          setSubmitting(false)
        }
      }}
    />
  )
}

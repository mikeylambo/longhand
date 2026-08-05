import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Stroke } from '../engine/types'
import { createSession, type CanvasState } from '../data/session'
import { loadSignature, type StoredSignature } from '../store'
import { SignaturePad } from './SignaturePad'
import { DrawTurn } from './DrawTurn'
import { Review } from './Review'
import { Welcome, markWelcomed, seenWelcome } from './Welcome'

type Phase = 'loading' | 'welcome' | 'signature' | 'draw' | 'review' | 'error'

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

  /**
   * Claiming a slot, on every path that leads to one.
   *
   * `fresh` is the difference between carrying on and starting over, and only
   * local mode can tell them apart: with no ledger the relay is faked in one
   * browser, so "next slot" means the next slot on this fake canvas until it
   * fills. Against the ledger both mean the same thing, because one hand per
   * canvas makes drawing again necessarily somewhere else.
   */
  const take = useCallback(
    async (slots?: number, fresh = false) => {
      setPhase('loading')
      setError(null)
      try {
        const joined = fresh
          ? await session.nextCanvas(slots)
          : await session.join(slots)
        transition(() => {
          setJustDrawn([])
          setCanvas(joined)
          setPhase('draw')
        })
      } catch (e) {
        setError(message(e))
        setPhase('error')
      }
    },
    [session],
  )

  const boot = useCallback(async () => {
    setPhase('loading')
    setError(null)
    // A returning hand goes straight to a sheet. The welcome screen is for
    // somebody who has never seen this, and seeing it twice would be a lecture.
    if (!session.hasSignature()) {
      setPhase(seenWelcome() ? 'signature' : 'welcome')
      return
    }
    await take()
  }, [session, take])

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

  if (phase === 'welcome') {
    return (
      <Welcome
        onStart={() => {
          markWelcomed()
          transition(() => setPhase('signature'))
        }}
      />
    )
  }

  if (phase === 'signature') {
    return (
      <SignaturePad
        onDone={async (strokes) => {
          setPhase('loading')
          try {
            await session.registerSignature(strokes)
            setSignature(loadSignature())
            await take()
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
        onNext={(slots) => void take(slots, canvas.closed)}
      />
    )
  }

  return (
    <DrawTurn
      key={`${canvas.turnId ?? canvas.canvasId ?? canvas.seed}-${canvas.slot}`}
      seed={canvas.seed}
      slot={canvas.slot}
      slotCount={canvas.slotCount}
      palette={canvas.palette}
      priorLayers={canvas.priorLayers}
      width={canvas.width}
      height={canvas.height}
      expiresAt={canvas.expiresAt}
      canvasId={canvas.canvasId}
      onExpired={() => void take(undefined, true)}
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

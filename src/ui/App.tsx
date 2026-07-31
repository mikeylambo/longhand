import { useCallback, useEffect, useState } from 'react'
import type { Stroke } from '../engine/types'
import { createSession, type CanvasState } from '../data/session'
import { loadSignature, type StoredSignature } from '../store'
import { SignaturePad } from './SignaturePad'
import { DrawTurn } from './DrawTurn'
import { Review } from './Review'

type Phase = 'loading' | 'signature' | 'draw' | 'review' | 'error'

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'something went wrong'

export function App() {
  const [session] = useState(createSession)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<CanvasState | null>(null)
  const [justDrawn, setJustDrawn] = useState<Stroke[]>([])
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
      setCanvas(await session.join())
      setPhase('draw')
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
            setSignature(loadSignature())
            setCanvas(await session.join())
            setPhase('draw')
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
      key={`${canvas.canvasId ?? canvas.seed}-${canvas.slot}`}
      seed={canvas.seed}
      slot={canvas.slot}
      palette={canvas.palette}
      priorLayers={canvas.priorLayers}
      onSubmit={async (layer) => {
        setJustDrawn(layer)
        setPhase('loading')
        try {
          setCanvas(await session.submit(layer))
          setPhase('review')
        } catch (e) {
          setError(message(e))
          setPhase('error')
        }
      }}
    />
  )
}

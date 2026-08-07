import { useCallback, useEffect, useState } from 'react'
import type { Stroke } from '../engine/types'
import { createSession, type CanvasState } from '../data/session'
import { loadSignature, type StoredSignature } from '../store'
import { SignaturePad } from './SignaturePad'
import { DrawTurn } from './DrawTurn'
import { Review } from './Review'
import { Welcome, markWelcomed, seenWelcome } from './Welcome'
import { Invitation } from './Invitation'
import { peekGift, type GiftPeek } from '../data/ledger'
import { clearDraft } from '../data/draft'
import { navigate } from './Router'
import { finishCoaching } from './coach'
import { transition } from './transition'
import { LEDGER_ENABLED } from '../lib/supabase'

type Phase =
  | 'loading'
  | 'welcome'
  | 'invited'
  | 'signature'
  | 'draw'
  | 'review'
  | 'error'

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'something went wrong'

export function App({ giftToken }: { giftToken?: string } = {}) {
  const [session] = useState(createSession)
  const [gift, setGift] = useState<GiftPeek | null>(null)
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

  /** Taking the place somebody saved, which is a different act from being
   *  assigned one and should never quietly become one. */
  const accept = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const joined = await session.redeemGift(giftToken!)
      transition(() => {
        setJustDrawn([])
        setCanvas(joined)
        setPhase('draw')
      })
    } catch (e) {
      setError(message(e))
      setPhase('error')
    }
  }, [session, giftToken])

  const boot = useCallback(async () => {
    setPhase('loading')
    setError(null)

    // An invitation names a canvas, so it is answered before anything else —
    // including the welcome screen, which would otherwise talk about taking
    // whatever slot is going to somebody who has been offered a particular one.
    if (giftToken && LEDGER_ENABLED) {
      const peek = await peekGift(giftToken)
      setGift(peek)
      if (peek && !peek.taken && !peek.expired) {
        markWelcomed()
        setPhase('invited')
        return
      }
      // A spent or expired invitation is not an error to shout about: the
      // canvas is still there and there are other places on it.
    }

    // A returning hand goes straight to a sheet. The welcome screen is for
    // somebody who has never seen this, and seeing it twice would be a lecture.
    if (!session.hasSignature()) {
      setPhase(seenWelcome() ? 'signature' : 'welcome')
      return
    }
    await take()
  }, [session, take, giftToken])

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

  if (phase === 'invited' && gift) {
    return (
      <Invitation
        gift={gift}
        hasMark={session.hasSignature()}
        onAccept={() => {
          if (session.hasSignature()) void accept()
          else transition(() => setPhase('signature'))
        }}
      />
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
            // Signing on the way in from an invitation lands on the place that
            // was saved, not on whatever the relay would have handed out.
            if (giftToken && gift && !gift.taken && !gift.expired) await accept()
            else await take()
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
      onLeave={() => {
        // Released first, then left. The other way round navigates away from
        // the only code that knows the turn id, and the canvas waits out a
        // ten-minute clock for a slot nobody is using.
        void session.abandon().finally(() => {
          clearDraft()
          // Deliberately not finishCoaching(): handing a slot back is not
          // completing a turn, and somebody who backs out of their first one
          // has not learned any of it yet.
          navigate('/gallery')
        })
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
          // Only once it is really in the ledger. Clearing on the tap would
          // mean a dropped connection took both the save and the only other
          // copy, which is the failure this draft exists to prevent.
          clearDraft()
          // A whole turn taught these by doing them; being coached on the
          // second turn is the thing every app gets wrong.
          finishCoaching()
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

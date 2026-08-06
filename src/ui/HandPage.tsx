import { useEffect, useMemo, useState } from 'react'
import { renderLayers } from '../engine/render'
import { CANVAS_H, CANVAS_W, SIGNATURE_H, SIGNATURE_W, formatFor } from '../config'
import {
  cachedSignatureId,
  fetchHandCanvases,
  fetchSignatures,
  sharedCanvasIds,
  type HandCanvas,
} from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import type { Stroke } from '../engine/types'
import { Footer } from './Footer'

/**
 * A hand's page. The signature is the account, so this is the whole of a
 * profile: a mark, and everything it has been part of.
 *
 * There is no bio, no follower count, no way to send anything. Recognition
 * without a network — "you have shared four canvases with this hand" is the
 * most this will ever say about a relationship, and it is enough. The moment
 * there is a follow button this stops being a museum.
 */
export function HandPage({ signatureId }: { signatureId: string }) {
  const [mark, setMark] = useState<Stroke[] | null>(null)
  const [canvases, setCanvases] = useState<HandCanvas[] | null>(null)
  const [shared, setShared] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  const mine = cachedSignatureId()
  const isMe = mine === signatureId

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there are no hands to show.')
      return
    }
    let alive = true
    Promise.all([
      fetchSignatures([signatureId]),
      fetchHandCanvases(signatureId),
      mine ? sharedCanvasIds(mine, signatureId) : Promise.resolve([]),
    ])
      .then(([marks, list, both]) => {
        if (!alive) return
        setMark(marks.get(signatureId) ?? null)
        setCanvases(list)
        setShared(both.length)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [signatureId, mine])

  const markSrc = useMemo(
    () =>
      mark
        ? renderLayers(SIGNATURE_W, SIGNATURE_H, [mark], { scale: 0.5 }).toDataURL(
            'image/png',
          )
        : null,
    [mark],
  )

  if (error) {
    return (
      <div className="panel center">
        <h1>Nothing here</h1>
        <p>{error}</p>
        <div className="row">
          <a className="linkbtn" href="/">
            Take a slot instead
          </a>
        </div>
      </div>
    )
  }

  const closed = canvases?.filter((c) => c.canvas.status === 'closed').length ?? 0

  return (
    <div className="panel">
      <h1>{isMe ? 'Your hand' : 'This hand'}</h1>
      {markSrc ? (
        <img className="review-art mark" src={markSrc} alt="Their mark" />
      ) : (
        <p className="stat">Loading…</p>
      )}

      <div className="scroll">
        {canvases && (
          <p className="stat">
            {canvases.length === 0
              ? 'Nothing yet.'
              : `${canvases.length} ${canvases.length === 1 ? 'canvas' : 'canvases'}, ` +
                `${closed} finished.`}
            {/* The one thing this page says about a relationship, and the
                reason it exists at all. */}
            {!isMe && shared > 0 && (
              <>
                {' '}
                You have shared {shared} {shared === 1 ? 'canvas' : 'canvases'} with
                this hand.
              </>
            )}
          </p>
        )}

        <div className="cards">
          {canvases?.map((c) => (
            <HandCard key={c.layerId} item={c} />
          ))}
        </div>

        {canvases?.length === 0 && (
          <p className="stat">
            A hand appears here the first time it finishes a turn.
          </p>
        )}
      </div>

      <div className="row">
        {isMe && (
          <a className="linkbtn" href="/mark">
            Your mark
          </a>
        )}
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          Take a slot
        </a>
      </div>

      <Footer wander />
    </div>
  )
}

/** Their layer alone, over a link to the canvas it belongs to. */
function HandCard({ item }: { item: HandCanvas }) {
  const w = item.canvas.width ?? CANVAS_W
  const h = item.canvas.height ?? CANVAS_H
  const src = useMemo(
    () => renderLayers(w, h, [item.strokes], { scale: 0.35 }).toDataURL('image/png'),
    [item.strokes, w, h],
  )
  return (
    <a className="card" href={`/c/${item.canvas.id}`}>
      <img src={src} alt={`Their layer on “${item.canvas.seed_word}”`} />
      <figcaption>
        <span className="seed-small">“{item.canvas.seed_word}”</span>
        <span>
          {item.slotIndex} / {formatFor(item.canvas.slot_count).slots}
        </span>
      </figcaption>
    </a>
  )
}

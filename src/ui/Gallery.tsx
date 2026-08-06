import { useEffect, useState } from 'react'
import { renderLayers } from '../engine/render'
import { CANVAS_H, CANVAS_W, formatFor } from '../config'
import {
  fetchClosedCanvases,
  fetchLayers,
  myCanvasIds,
  type CanvasRow,
} from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Footer } from './Footer'

/**
 * The archive. Per the brief this is the asset — the thing that gets more
 * valuable every year the product runs — so it is a plain list of finished
 * work with no counts, no ranking and no leaderboard, ever.
 */
export function Gallery() {
  const [canvases, setCanvases] = useState<CanvasRow[] | null>(null)
  const [mine, setMine] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is no archive yet.')
      return
    }
    fetchClosedCanvases()
      .then(setCanvases)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    // Separately, and allowed to lose. The archive is the point of this screen
    // and it should not wait on a question about the person looking at it.
    void myCanvasIds().then(setMine)
  }, [])

  return (
    <div className="panel">
      <h1>The gallery</h1>
      <p>
        Canvases every hand has been on. Nothing here can change again — not by
        the people who drew it, and not by us.
      </p>

      <div className="scroll">
        {error && <p className="stat">{error}</p>}
        {!error && !canvases && <p className="stat">Loading…</p>}
        {canvases?.length === 0 && (
          <p className="stat">
            Nothing has closed yet. The first canvas to fill lands here — a duo
            needs two hands, so it may not be long.
          </p>
        )}
        <div className="cards">
          {canvases?.map((c) => (
            <GalleryCard key={c.id} canvas={c} mine={mine.has(c.id)} />
          ))}
        </div>
      </div>

      {/* "Take a slot" was here; it is the Draw tab now. */}
      <Footer wander />
    </div>
  )
}

function GalleryCard({ canvas, mine }: { canvas: CanvasRow; mine: boolean }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchLayers(canvas.id)
      .then((layers) => {
        if (!alive) return
        setSrc(
          renderLayers(
            canvas.width ?? CANVAS_W,
            canvas.height ?? CANVAS_H,
            layers.map((l) => l.strokes),
            { scale: 0.35 },
          ).toDataURL('image/png'),
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [canvas.id, canvas.width, canvas.height])

  return (
    <a className="card" href={`/c/${canvas.id}`}>
      {src ? (
        <img src={src} alt={canvas.seed_word} />
      ) : (
        <div className="card-placeholder" />
      )}
      <figcaption>
        <span className="seed-small">“{canvas.seed_word}”</span>
        <span>
          {formatFor(canvas.slot_count).title}
          {/* Stated rather than counted. Somebody who has drawn for hours
              wants to find the ones they were on, and the alternative — a
              number of them, or an order that favours them — would be the
              ranking this archive has never had. */}
          {mine && <span className="yours"> · yours</span>}
        </span>
      </figcaption>
    </a>
  )
}

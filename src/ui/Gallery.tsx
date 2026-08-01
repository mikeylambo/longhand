import { useEffect, useState } from 'react'
import { renderLayers } from '../engine/render'
import { CANVAS_H, CANVAS_W } from '../config'
import { fetchClosedCanvases, fetchLayers, type CanvasRow } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'

/**
 * The archive. Per the brief this is the asset — the thing that gets more
 * valuable every year the product runs — so it is a plain list of finished
 * work with no counts, no ranking and no leaderboard, ever.
 */
export function Gallery() {
  const [canvases, setCanvases] = useState<CanvasRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is no archive yet.')
      return
    }
    fetchClosedCanvases()
      .then(setCanvases)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="panel">
      <h1>The gallery</h1>
      <p>Canvases that twelve hands finished. Nothing here can change again.</p>

      <div className="scroll">
        {error && <p className="stat">{error}</p>}
        {!error && !canvases && <p className="stat">Loading…</p>}
        {canvases?.length === 0 && (
          <p className="stat">
            Nothing has closed yet. The first canvas to reach twelve hands lands
            here.
          </p>
        )}
        <div className="cards">
          {canvases?.map((c) => (
            <GalleryCard key={c.id} canvas={c} />
          ))}
        </div>
      </div>

      <div className="row">
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          Take a slot
        </a>
      </div>
    </div>
  )
}

function GalleryCard({ canvas }: { canvas: CanvasRow }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchLayers(canvas.id)
      .then((layers) => {
        if (!alive) return
        setSrc(
          renderLayers(
            CANVAS_W,
            CANVAS_H,
            layers.map((l) => l.strokes),
            { scale: 0.35 },
          ).toDataURL('image/png'),
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [canvas.id])

  return (
    <a className="card" href={`/c/${canvas.id}`}>
      {src ? (
        <img src={src} alt={canvas.seed_word} />
      ) : (
        <div className="card-placeholder" />
      )}
      <figcaption>
        <span className="seed-small">“{canvas.seed_word}”</span>
        <span>{canvas.slots_filled} hands</span>
      </figcaption>
    </a>
  )
}

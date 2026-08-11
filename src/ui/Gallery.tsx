import { useCallback, useEffect, useRef, useState } from 'react'
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
 *
 * Two views, and the distinction is worth keeping honest. "Everything" is the
 * archive in the order it happened. "Yours" is a filter on the same list in
 * the same order — not a profile, not a score, and not a different ranking of
 * the same work. It exists because somebody who has drawn for hours should be
 * able to find what they drew, which is a navigation problem rather than a
 * reason to start counting things.
 */
export function Gallery() {
  const [canvases, setCanvases] = useState<CanvasRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [mine, setMine] = useState<Set<string>>(() => new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bumped on every view change so a page that arrives after the view has
  // moved on is dropped rather than appended to the wrong list.
  const run = useRef(0)

  const load = useCallback(
    async (opts: { append?: boolean; filtered?: boolean; ids?: Set<string> } = {}) => {
      const filtered = opts.filtered ?? onlyMine
      const ids = opts.ids ?? mine
      const token = opts.append ? run.current : ++run.current

      if (opts.append) setLoadingMore(true)
      else setCanvases(null)

      try {
        const page = await fetchClosedCanvases({
          cursor: opts.append ? cursor : null,
          onlyMine: filtered ? ids : undefined,
        })
        if (token !== run.current) return
        setCanvases((prev) => (opts.append && prev ? [...prev, ...page.canvases] : page.canvases))
        setCursor(page.cursor)
      } catch (e) {
        if (token !== run.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoadingMore(false)
      }
    },
    [cursor, mine, onlyMine],
  )

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is no archive yet.')
      return
    }
    void load()
    // Separately, and allowed to lose. The archive is the point of this screen
    // and it should not wait on a question about the person looking at it.
    void myCanvasIds().then(setMine)
    // First load only; the toggle drives every load after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const show = (filtered: boolean) => {
    if (filtered === onlyMine) return
    setOnlyMine(filtered)
    setCursor(null)
    void load({ filtered, ids: mine })
  }

  const empty = canvases?.length === 0

  return (
    <div className="panel">
      <h1>The gallery</h1>
      <p>
        A museum of finished pieces. Every canvas here is complete and
        untouched — preserved exactly as the last artist left it.
      </p>

      {/* Only once there is something of yours to filter to. A toggle that can
          only ever show an empty list is a dead control. */}
      {mine.size > 0 && (
        <div className="segmented" role="group" aria-label="Which canvases">
          <button
            className={`seg${!onlyMine ? ' on' : ''}`}
            aria-pressed={!onlyMine}
            onClick={() => show(false)}
          >
            Everything
          </button>
          <button
            className={`seg${onlyMine ? ' on' : ''}`}
            aria-pressed={onlyMine}
            onClick={() => show(true)}
          >
            Yours
          </button>
        </div>
      )}

      <div className="scroll">
        {error && <p className="stat">{error}</p>}
        {!error && !canvases && <p className="stat">Loading…</p>}
        {empty && !onlyMine && (
          <p className="stat">
            Nothing has closed yet. The first canvas to fill lands here — a duo
            needs two hands, so it may not be long.
          </p>
        )}
        {empty && onlyMine && (
          <p className="stat">
            None of the canvases you are on have finished yet. They land here
            when the last hand does.
          </p>
        )}

        <div className="cards">
          {canvases?.map((c) => (
            <GalleryCard key={c.id} canvas={c} mine={mine.has(c.id)} />
          ))}
        </div>

        {/* A button rather than an infinite scroll. This is an archive, and
            deciding to see more of it should be a decision. */}
        {cursor && (
          <div className="row more">
            <div className="spacer" />
            <button
              className="linkbtn"
              disabled={loadingMore}
              onClick={() => void load({ append: true })}
            >
              {loadingMore ? 'Fetching…' : 'Older'}
            </button>
            <div className="spacer" />
          </div>
        )}
      </div>

      {/* `/screen` is the same archive as a wall, for a room with a spare
          display. It had no link anywhere either, which made it indisting-
          uishable from a route somebody forgot to delete. It belongs here
          rather than on a tab, because it is a thing you do *to* the gallery
          rather than a fifth place to stand. */}
      <p className="chooser quiet">
        <a href="/screen">Show the archive as a wall</a>
      </p>

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

import { useEffect, useMemo, useState } from 'react'
import { renderLayers } from '../engine/render'
import { CANVAS_H, CANVAS_W } from '../config'
import { fetchLayers, fetchPinnedCanvases, type PinnedCanvas } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Footer } from './Footer'

/**
 * The world gallery: finished canvases, pinned where they closed.
 *
 * The deliberate inversion of a territorial pixel board. That is a map of
 * where your work is about to be painted over; this is a map of finished
 * pieces nobody can touch, and the difference is the whole product.
 *
 * A pin is a city, chosen from a list by the hand that opened the canvas.
 * Nothing here asks a browser where it is, and there is no location permission
 * prompt anywhere in this product — a canvas has a place, a person never does.
 *
 * The map is an equirectangular projection drawn as an SVG, which is
 * unfashionable and exactly right here: it is a few hundred bytes, it needs no
 * tile server, no API key and no third party watching who looks at what, and
 * it renders identically offline.
 */
export function WorldPage() {
  const [pins, setPins] = useState<PinnedCanvas[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PinnedCanvas | null>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is nothing on the map.')
      return
    }
    fetchPinnedCanvases()
      .then(setPins)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Several canvases from one city stack on one pin rather than overlapping.
  const byPlace = useMemo(() => {
    const map = new Map<string, PinnedCanvas[]>()
    for (const p of pins ?? []) {
      const list = map.get(p.place.id) ?? []
      list.push(p)
      map.set(p.place.id, list)
    }
    return [...map.values()]
  }, [pins])

  return (
    <div className="panel wide">
      <h1>The world</h1>
      <p>
        Art happens everywhere. This map shows where every canvas reached its
        final stroke. Open a drawing and you can pin its place, then watch it
        land here when it is done.
      </p>

      <div className="scroll">
        {error && <p className="stat">{error}</p>}
        {!error && !pins && <p className="stat">Loading…</p>}
        {pins?.length === 0 && (
          <p className="stat">
            Nothing is pinned yet. The hand that opens a canvas can say where it
            is, and when that canvas finishes it lands here.
          </p>
        )}

        {pins && pins.length > 0 && (
          <div className="worldmap">
            <svg viewBox="0 0 360 180" role="img" aria-label="Finished canvases around the world">
              <rect x="0" y="0" width="360" height="180" className="sea" />
              {/* Latitude and longitude at thirty degrees: enough to read the
                  shape of the world without pretending to be an atlas. */}
              {[30, 60, 90, 120, 150].map((y) => (
                <line key={y} x1="0" y1={y} x2="360" y2={y} className="grat" />
              ))}
              {[60, 120, 180, 240, 300].map((x) => (
                <line key={x} x1={x} y1="0" x2={x} y2="180" className="grat" />
              ))}
              {byPlace.map((group) => {
                const { lat, lon } = group[0].place
                const x = ((Number(lon) + 180) / 360) * 360
                const y = ((90 - Number(lat)) / 180) * 180
                return (
                  <g key={group[0].place.id}>
                    <circle
                      cx={x}
                      cy={y}
                      r={2 + Math.min(4, group.length)}
                      className={`pin${selected?.place.id === group[0].place.id ? ' on' : ''}`}
                      onClick={() => setSelected(group[0])}
                    />
                    <title>
                      {group[0].place.name} — {group.length}{' '}
                      {group.length === 1 ? 'canvas' : 'canvases'}
                    </title>
                  </g>
                )
              })}
            </svg>
          </div>
        )}

        {selected && (
          <>
            <div className="review-caption">
              {selected.place.name}, {selected.place.country}
            </div>
            <div className="cards">
              {(pins ?? [])
                .filter((p) => p.place.id === selected.place.id)
                .map((p) => (
                  <PinCard key={p.canvas.id} pin={p} />
                ))}
            </div>
          </>
        )}

        {pins && pins.length > 0 && !selected && (
          <p className="stat">Tap a pin to see what closed there.</p>
        )}
      </div>

      {/* The gallery link and "Take a slot" both used to live here, because
          the old footer dropped its destinations on exactly this screen. The
          tab bar carries them now, and a pill that duplicates a tab two
          centimetres below it is furniture. */}
      <Footer wander />
    </div>
  )
}

function PinCard({ pin }: { pin: PinnedCanvas }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchLayers(pin.canvas.id)
      .then((layers) => {
        if (!alive) return
        setSrc(
          renderLayers(
            pin.canvas.width ?? CANVAS_W,
            pin.canvas.height ?? CANVAS_H,
            layers.map((l) => l.strokes),
            { scale: 0.35 },
          ).toDataURL('image/png'),
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [pin.canvas.id, pin.canvas.width, pin.canvas.height])

  return (
    <a className="card" href={`/c/${pin.canvas.id}`}>
      {src ? (
        <img src={src} alt={pin.canvas.seed_word} />
      ) : (
        <div className="card-placeholder" />
      )}
      <figcaption>
        <span className="seed-small">“{pin.canvas.seed_word}”</span>
        <span>{pin.place.name}</span>
      </figcaption>
    </a>
  )
}

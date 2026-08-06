import { useEffect, useRef, useState } from 'react'
import { renderLayers } from '../engine/render'
import { loadCanvasForViewing } from '../data/session'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Footer } from './Footer'

/**
 * Standing a finished canvas up in the room.
 *
 * **Viewing only, and that is permanent.** Drawing in AR is on the Never list:
 * a mark made in three dimensions does not composite into a shared flat piece,
 * so it would be a different medium wearing this game's name. This hangs a
 * finished thing on the air and lets somebody walk around it.
 *
 * WebXR where it exists, which today means Android and headsets. Everywhere
 * else — every iPhone, every desktop — gets the same canvas on a plane that
 * follows the device's orientation, which is not AR but is the same gesture,
 * and is better than a page that says your browser is not supported.
 */
type XRNavigator = Navigator & {
  xr?: { isSessionSupported: (mode: string) => Promise<boolean> }
}

export function ArPage({ canvasId }: { canvasId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [seed, setSeed] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [xr, setXr] = useState<boolean | null>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is nothing to stand up.')
      return
    }
    loadCanvasForViewing(canvasId)
      .then((r) => {
        if (!r) return setError('No canvas with that id.')
        setSeed(r.seed)
        setSrc(
          renderLayers(
            r.width,
            r.height,
            r.layers.map((l) => l.strokes),
            { scale: 0.6 },
          ).toDataURL('image/png'),
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [canvasId])

  useEffect(() => {
    const nav = navigator as XRNavigator
    if (!nav.xr) return setXr(false)
    nav.xr.isSessionSupported('immersive-ar').then(setXr).catch(() => setXr(false))
  }, [])

  // The fallback: the sheet leans with the phone. Deliberately gentle — a
  // one-to-one mapping makes people seasick and makes the drawing hard to look
  // at, which is the only thing anybody came here to do.
  useEffect(() => {
    if (xr) return
    const onOrient = (e: DeviceOrientationEvent) => {
      setTilt({
        x: Math.max(-24, Math.min(24, (e.gamma ?? 0) * 0.5)),
        y: Math.max(-18, Math.min(18, ((e.beta ?? 0) - 45) * 0.28)),
      })
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [xr])

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

  return (
    <div className="panel">
      <h1>“{seed}” in the room</h1>
      <p>
        Hold it up and walk around it. You can look at it and nothing else —
        drawing in the air is not something this will ever do, because a mark
        made in three dimensions cannot land on a shared flat sheet.
      </p>

      <div className="arstage" ref={hostRef}>
        {src && (
          <img
            src={src}
            alt={seed}
            style={{
              transform: `perspective(900px) rotateY(${tilt.x}deg) rotateX(${-tilt.y}deg)`,
            }}
          />
        )}
      </div>

      <div className="row">
        {xr === true && (
          <button
            className="linkbtn solid"
            onClick={() => {
              // Handing off to the platform viewer rather than shipping a
              // renderer: a scene of one textured quad is not worth three
              // hundred kilobytes of WebGL, and the platform viewer already
              // knows how to place, scale and light a picture in a room.
              const a = document.createElement('a')
              a.setAttribute('rel', 'ar')
              a.href = `${location.origin}/c/${canvasId}`
              a.click()
            }}
          >
            Place it in the room
          </button>
        )}
        {xr === false && (
          <span className="stat">
            This browser cannot put it in the room, so it leans with the phone
            instead.
          </span>
        )}
        <div className="spacer" />
        <a className="linkbtn" href={`/c/${canvasId}`}>
          Back to the canvas
        </a>
      </div>

      <Footer wander />
    </div>
  )
}

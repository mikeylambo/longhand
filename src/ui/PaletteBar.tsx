import { useEffect, useRef, useState } from 'react'
import { clampToGamut, contrastInk, family } from '../colour'

interface Props {
  /** The base swatches this turn was offered. */
  palette: string[]
  value: string
  onChange: (hex: string) => void
}

const LONG_PRESS_MS = 380
const MOVE_CANCELS_PX = 10

/**
 * Sixteen swatches, five colours behind each, and any hue you like held to the
 * palette's light.
 *
 * The fan-out is a long press rather than a second row because the vertical
 * space belongs to the sheet, and because it is the gesture people already have
 * for "show me more of this" — no affordance to teach.
 *
 * There is no hex field on purpose. A typed colour is a text input, which the
 * brief rules out, and an unrestricted one puts a stroke into a permanent
 * archive that can never sit with the other fifteen. The hue slider gives the
 * whole wheel; saturation and lightness stay inside the range measured from the
 * sixteen. `colour_allowed()` enforces the same rule server-side, so the UI can
 * never offer something that will be refused after the drawing is done.
 */
export function PaletteBar({ palette, value, onChange }: Props) {
  const [openFamily, setOpenFamily] = useState<string | null>(null)
  const [hue, setHue] = useState(210)
  const [pickingHue, setPickingHue] = useState(false)
  const [customs, setCustoms] = useState<string[]>([])
  const timer = useRef<number | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const longFired = useRef(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openFamily && !pickingHue) return
    const close = (e: Event) => {
      if (barRef.current?.contains(e.target as Node)) return
      setOpenFamily(null)
      setPickingHue(false)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [openFamily, pickingHue])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const startPress = (hex: string, e: React.PointerEvent) => {
    longFired.current = false
    origin.current = { x: e.clientX, y: e.clientY }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      longFired.current = true
      setPickingHue(false)
      setOpenFamily(hex)
    }, LONG_PRESS_MS)
  }

  const movePress = (e: React.PointerEvent) => {
    const o = origin.current
    if (!o) return
    if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_CANCELS_PX) {
      window.clearTimeout(timer.current)
    }
  }

  const endPress = (hex: string) => {
    window.clearTimeout(timer.current)
    origin.current = null
    // A long press has already opened the fan; don't also select on release.
    if (longFired.current) return
    setOpenFamily(null)
    setPickingHue(false)
    onChange(hex)
  }

  const preview = clampToGamut(hue)

  return (
    <div className="palettebar" ref={barRef}>
      {openFamily && (
        <div className="fan" role="group" aria-label={`Shades of ${openFamily}`}>
          {family(openFamily).map((hex) => (
            <button
              key={hex}
              className={`swatch small${hex === value ? ' on' : ''}`}
              style={{ background: hex, color: contrastInk(hex) }}
              onClick={() => {
                onChange(hex)
                setOpenFamily(null)
              }}
              aria-label={hex}
            />
          ))}
        </div>
      )}

      {pickingHue && (
        <div className="huepicker">
          <span className="swatch small on" style={{ background: preview, color: contrastInk(preview) }} />
          <input
            className="huerange"
            type="range"
            min={0}
            max={359}
            value={hue}
            onChange={(e) => {
              const h = Number(e.target.value)
              setHue(h)
              onChange(clampToGamut(h))
            }}
            aria-label="Hue"
          />
          <button
            className="linkbtn tiny"
            onClick={() => {
              setCustoms((c) => [preview, ...c.filter((x) => x !== preview)].slice(0, 4))
              setPickingHue(false)
            }}
          >
            Keep
          </button>
        </div>
      )}

      <div className="palette">
        {palette.map((hex) => (
          <button
            key={hex}
            className={`swatch${hex === value ? ' on' : ''}${openFamily === hex ? ' open' : ''}`}
            style={{ background: hex }}
            onPointerDown={(e) => startPress(hex, e)}
            onPointerMove={movePress}
            onPointerUp={() => endPress(hex)}
            onPointerCancel={() => window.clearTimeout(timer.current)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={hex}
          />
        ))}

        {customs.map((hex) => (
          <button
            key={hex}
            className={`swatch${hex === value ? ' on' : ''}`}
            style={{ background: hex }}
            onPointerDown={(e) => startPress(hex, e)}
            onPointerMove={movePress}
            onPointerUp={() => endPress(hex)}
            aria-label={hex}
          />
        ))}

        <button
          className={`swatch mix${pickingHue ? ' on' : ''}`}
          onClick={() => {
            setOpenFamily(null)
            setPickingHue((p) => !p)
            if (!pickingHue) onChange(clampToGamut(hue))
          }}
          aria-label="Mix a colour"
        />
      </div>
    </div>
  )
}

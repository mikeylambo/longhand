import type { Stroke } from '../engine/types'
import { drawStroke, renderLayers } from '../engine/render'
import { buildTimeline, paintRange } from '../engine/timelapse'
import { decodeLayer, encodeLayer } from '../engine/codec'
import { MASTER_PALETTE, PAPER, PEN_WIDTHS } from '../config'

/**
 * Replay exactness.
 *
 * Nothing here stores a picture — it stores the instructions for drawing one.
 * So the picture exists twice: once as it was painted under the artist's
 * finger, and again every time it is rebuilt from the ledger for the gallery,
 * the timelapse, or a print.
 *
 * If those two ever disagree — a rounded coordinate, an edge that blends
 * differently the second time, two strokes composited in a different order —
 * the drift is invisible in one layer and compounds through twelve. You find
 * out when a canvas closes, by which point every canvas is subtly wrong.
 *
 * These checks are pixel-exact on purpose. "Looks the same" is not a result.
 *
 * Every check runs at BOTH sheet shapes. A canvas stores the dimensions it was
 * opened at and renders against those forever, so the square default and the
 * 2048×1536 canvases already in the archive are two live code paths, not one
 * current and one historical.
 */

export interface Check {
  name: string
  detail: string
  differing: number
  total: number
  pass: boolean
}

export interface Shape {
  label: string
  width: number
  height: number
}

/** The square default, and the shape canvases opened before it existed. */
export const SHAPES: Shape[] = [
  { label: '2048×2048', width: 2048, height: 2048 },
  { label: '2048×1536', width: 2048, height: 1536 },
]

// ------------------------------------------------------------------ fixtures

/** Deterministic PRNG, so a failure is always reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Layers built to hit the cases that actually break renderers: single-point
 * dots, strokes that cross themselves, strokes that run off the sheet, hairline
 * and broad widths in the same layer, and coordinates carrying the same one and
 * two decimal rounding the capture path applies.
 */
function fixtureLayers(
  count: number,
  width: number,
  height: number,
): { slotIndex: number; strokes: Stroke[] }[] {
  const rand = rng(0x10ada11)
  const layers: { slotIndex: number; strokes: Stroke[] }[] = []

  for (let li = 0; li < count; li++) {
    const strokes: Stroke[] = []
    const strokeCount = 3 + Math.floor(rand() * 4)

    for (let si = 0; si < strokeCount; si++) {
      const color = MASTER_PALETTE[Math.floor(rand() * MASTER_PALETTE.length)]
      const size = Math.floor(rand() * PEN_WIDTHS.length)
      const base = PEN_WIDTHS[size]
      const pts = []

      // Every fifth stroke is a tap — a one-point stroke takes a different
      // code path (an arc, not a curve).
      const n = si % 5 === 4 ? 1 : 12 + Math.floor(rand() * 60)
      // Deliberately start some strokes off the sheet so clipping is exercised.
      const ox = -200 + rand() * (width + 400)
      const oy = -200 + rand() * (height + 400)
      let x = ox
      let y = oy

      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1)
        x = ox + Math.cos(t * Math.PI * (1 + rand() * 3)) * 300 * rand() + t * 500
        y = oy + Math.sin(t * Math.PI * (1 + rand() * 3)) * 240 * rand()
        const taper = Math.min(1, Math.min(i, n - 1 - i) / 4)
        pts.push({
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          w: Math.round(base * (0.5 + taper * 0.7) * 100) / 100,
          t: i * 16,
        })
      }

      strokes.push({
        color,
        size,
        t0: si * 1000,
        ink: Math.round(rand() * 900),
        pts,
      })
    }
    layers.push({ slotIndex: li + 1, strokes })
  }
  return layers
}

// --------------------------------------------------------------- pixel diff

/**
 * Every canvas here is created exactly the way the product creates one —
 * `getContext('2d')` with no attributes.
 *
 * This is not fussiness. Passing `willReadFrequently: true` moves Chromium onto
 * a software rasteriser, which anti-aliases differently from the GPU path the
 * app actually draws on. Mixing the two made this suite report a 5.9% pixel
 * divergence that existed only inside the test.
 */
function surface(
  width: number,
  height: number,
  scale: number,
): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas')
  cv.width = Math.round(width * scale)
  cv.height = Math.round(height * scale)
  const ctx = cv.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)
  return { cv, ctx }
}

function diff(
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
): { differing: number; total: number } {
  const total = a.width * a.height
  if (a.width !== b.width || a.height !== b.height) {
    return { differing: total, total }
  }
  const da = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data
  const db = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data

  let differing = 0
  for (let i = 0; i < da.length; i += 4) {
    if (
      da[i] !== db[i] ||
      da[i + 1] !== db[i + 1] ||
      da[i + 2] !== db[i + 2] ||
      da[i + 3] !== db[i + 3]
    ) {
      differing++
    }
  }
  return { differing, total }
}

// ------------------------------------------------------------------- checks

function checksFor(shape: Shape, scale: number): Check[] {
  const { width, height, label } = shape
  const layers = fixtureLayers(12, width, height)
  const allStrokes = layers.map((l) => l.strokes)
  const checks: Check[] = []

  const add = (
    name: string,
    detail: string,
    d: { differing: number; total: number },
  ) =>
    checks.push({
      name: `${label} · ${name}`,
      detail,
      ...d,
      pass: d.differing === 0,
    })

  // 1. The codec must be lossless. Points are already rounded at capture, so
  //    encode/decode has nothing left to round away — prove it, don't assume.
  const encoded = allStrokes.map((s) => encodeLayer(s, width, height))
  const decoded = encoded.map(decodeLayer)
  add(
    'codec is lossless',
    'decode(encode(strokes)) deep-equals strokes',
    {
      differing: JSON.stringify(allStrokes) === JSON.stringify(decoded) ? 0 : 1,
      total: 1,
    },
  )

  // 2. Re-encoding a decoded layer must be byte-identical, or the ledger drifts
  //    every time a layer is read and written back.
  add('encoding is stable', 'encode(decode(encode(x))) is byte-identical', {
    differing:
      JSON.stringify(encoded) ===
      JSON.stringify(decoded.map((s) => encodeLayer(s, width, height)))
        ? 0
        : 1,
    total: 1,
  })

  // 3. The encoded layer must carry the shape it was drawn against, or a
  //    renderer has nothing to fall back on but a client constant.
  add('encoded layer records its sheet', 'w and h survive the round trip', {
    differing: encoded.every((e) => e.w === width && e.h === height) ? 0 : 1,
    total: 1,
  })

  // 4. The renderer must be deterministic before anything else is meaningful.
  const once = renderLayers(width, height, allStrokes, { scale })
  const twice = renderLayers(width, height, allStrokes, { scale })
  add('render is deterministic', 'same vectors rendered twice', diff(once, twice))

  // 5. What was stored must reproduce what was drawn. This is the whole promise
  //    of storing vectors instead of pixels.
  add(
    'ledger round-trip is exact',
    'render(decode(encode(x))) vs render(x)',
    diff(once, renderLayers(width, height, decoded, { scale })),
  )

  // 6. The timelapse walked to the end must equal the archived snapshot. If it
  //    does not, the video and the print disagree.
  const timeline = buildTimeline(layers)
  const whole = surface(width, height, scale)
  paintRange(whole.ctx, timeline, 0, timeline.total)
  add(
    'timelapse end-state matches snapshot',
    'paintRange(0, total) vs one-shot render',
    diff(once, whole.cv),
  )

  // 7. And it must not matter how many steps the scrub took to get there —
  //    a viewer who drags the slider must land on the same image as one who
  //    lets it play, or as the video export.
  for (const steps of [2, 7, 113]) {
    const s = surface(width, height, scale)
    for (let i = 1; i <= steps; i++) {
      paintRange(
        s.ctx,
        timeline,
        Math.round(((i - 1) / steps) * timeline.total),
        Math.round((i / steps) * timeline.total),
      )
    }
    add(
      `timelapse in ${steps} steps matches snapshot`,
      'incremental compositing must not accumulate error',
      diff(once, s.cv),
    )
  }

  // 8. Layers composited one at a time must equal all layers in one pass —
  //    otherwise "your layer alone" and the full canvas are drawn by different
  //    maths, and hiding a layer would shift the ones around it.
  const stacked = surface(width, height, scale)
  for (const layer of layers)
    for (const st of layer.strokes) drawStroke(stacked.ctx, st)
  add(
    'layer-by-layer equals one pass',
    'compositing is associative across layers',
    diff(once, stacked.cv),
  )

  // 9. Hiding a layer must remove exactly that layer and disturb nothing else.
  const visible = new Set(
    layers.map((l) => l.slotIndex).filter((i) => i !== 7),
  )
  const withoutSeven = renderLayers(
    width,
    height,
    layers.filter((l) => l.slotIndex !== 7).map((l) => l.strokes),
    { scale },
  )
  const viaTimeline = surface(width, height, scale)
  const tl7 = buildTimeline(layers, visible)
  paintRange(viaTimeline.ctx, tl7, 0, tl7.total)
  add(
    'hiding a layer is surgical',
    'timeline without slot 7 vs render without slot 7',
    diff(withoutSeven, viaTimeline.cv),
  )

  return checks
}

export function runSelfTest(scale = 1): { checks: Check[]; ok: boolean } {
  const checks = SHAPES.flatMap((shape) => checksFor(shape, scale))
  return { checks, ok: checks.every((c) => c.pass) }
}

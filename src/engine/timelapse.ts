import type { Stroke } from './types'
import { drawSegments } from './render'

export interface TimelapseLayer {
  slotIndex: number
  strokes: Stroke[]
}

export interface Cue {
  stroke: Stroke
  /** Global point index this stroke begins at. */
  start: number
  len: number
}

export interface Timeline {
  cues: Cue[]
  total: number
}

/**
 * Flattens the canvas into one ordered walk of stroke samples: layers in slot
 * order, strokes in the order they were drawn. Position along the walk is the
 * timelapse clock.
 */
export function buildTimeline(
  layers: TimelapseLayer[],
  visible?: ReadonlySet<number>,
): Timeline {
  const cues: Cue[] = []
  let n = 0
  for (const layer of layers) {
    if (visible && !visible.has(layer.slotIndex)) continue
    for (const stroke of layer.strokes) {
      cues.push({ stroke, start: n, len: stroke.pts.length })
      n += stroke.pts.length
    }
  }
  return { cues, total: n }
}

/**
 * Draws the samples in [from, to) onto an already-cleared, already-transformed
 * context. Every sample index is drawn exactly once, so walking the timeline in
 * any number of steps composites identically to drawing it in one — which is
 * what makes a scrubbed timelapse and an archived snapshot the same image.
 * `selftest` asserts that, because a drift here is invisible until a canvas
 * closes and then it is in the print.
 */
export function paintRange(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  from: number,
  to: number,
): void {
  for (const cue of timeline.cues) {
    const end = cue.start + cue.len
    if (end <= from) continue
    if (cue.start >= to) break
    const a = Math.max(0, from - cue.start)
    const b = Math.min(cue.len, to - cue.start)
    if (b > a) drawSegments(ctx, cue.stroke, a, b)
  }
}

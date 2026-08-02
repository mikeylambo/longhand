import { PAPER } from '../config'
import { buildTimeline, paintRange, type TimelapseLayer } from './timelapse'

export interface VideoOptions {
  layers: TimelapseLayer[]
  /** The sheet this canvas was opened at. */
  width: number
  height: number
  seed: string
  hands: number
  /** Total running time including the hold. */
  totalMs?: number
  /** How long to rest on the finished piece before the file ends. */
  holdMs?: number
  fps?: number
  /** Longest edge of the exported frame. */
  maxDim?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export interface RenderedVideo {
  blob: Blob
  extension: string
  mimeType: string
}

/**
 * Preference order, not a guess: MP4 plays everywhere and is what a share sheet
 * expects, so it is tried first and WebM is the fallback for browsers whose
 * MediaRecorder cannot mux H.264. The caller gets the extension that matches
 * what was actually produced rather than a filename that lies.
 */
const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function pickMimeType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const mimeType of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' }
    }
  }
  return null
}

/**
 * The card the video ends on, so the artifact carries its own context when it
 * turns up in someone's feed with no page around it. Faded in only after the
 * drawing finishes, so it never covers a stroke being made.
 *
 * Exported so it can be rendered and looked at without recording 20 seconds.
 */
export function paintCaption(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; seed: string; hands: number; alpha: number },
): void {
  const { width: fw, height: fh, seed, hands, alpha } = o
  if (alpha <= 0) return

  const pad = Math.round(fh * 0.05)
  const bandH = Math.round(fh * 0.2)
  const grad = ctx.createLinearGradient(0, fh - bandH, 0, fh)
  grad.addColorStop(0, 'rgba(242,237,227,0)')
  grad.addColorStop(1, `rgba(242,237,227,${0.96 * alpha})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, fh - bandH, fw, bandH)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = `rgba(27,26,23,${alpha})`
  ctx.font = `italic ${Math.round(fh * 0.055)}px "Iowan Old Style", Palatino, Georgia, serif`
  ctx.fillText(`“${seed}”`, fw / 2, fh - pad - Math.round(fh * 0.042))

  ctx.fillStyle = `rgba(138,132,120,${alpha})`
  ctx.font = `${Math.round(fh * 0.024)}px ui-sans-serif, -apple-system, sans-serif`
  ctx.letterSpacing = '0.18em'
  ctx.fillText(
    (hands === 1 ? '1 hand' : `${hands} hands`).toUpperCase(),
    fw / 2,
    fh - pad,
  )
  ctx.letterSpacing = '0px'
}

export const videoExportSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
  pickMimeType() !== null

/**
 * Renders the timelapse to a video file.
 *
 * The walk over the ledger is `buildTimeline`/`paintRange` — the same code the
 * in-app scrubber uses, and the same code `selftest` proves lands on pixels
 * identical to the archived snapshot however many steps it takes. So the video,
 * the scrubber and the print cannot disagree.
 *
 * Two canvases: strokes accumulate on `art` append-only, exactly as they do
 * live, and each frame blits that onto the captured `frame` canvas so the
 * caption can fade in over the hold without disturbing what was drawn.
 *
 * Duration is fixed regardless of layer count — position along the walk is
 * normalised — because a shareable artifact that runs 8 seconds for one canvas
 * and 40 for another isn't a format.
 */
export async function renderTimelapseVideo(
  opts: VideoOptions,
): Promise<RenderedVideo> {
  const {
    layers,
    width,
    height,
    seed,
    hands,
    totalMs = 20_000,
    holdMs = 3_500,
    fps = 30,
    maxDim = 1080,
    onProgress,
    signal,
  } = opts

  const picked = pickMimeType()
  if (!picked) throw new Error('this browser cannot record video')

  const timeline = buildTimeline(layers)
  if (timeline.total === 0) throw new Error('there is nothing to replay yet')

  // Even dimensions — H.264 rejects odd ones.
  const scale = maxDim / Math.max(width, height)
  const fw = Math.round((width * scale) / 2) * 2
  const fh = Math.round((height * scale) / 2) * 2

  const art = document.createElement('canvas')
  art.width = fw
  art.height = fh
  const actx = art.getContext('2d')!
  actx.setTransform(1, 0, 0, 1, 0, 0)
  actx.fillStyle = PAPER
  actx.fillRect(0, 0, fw, fh)
  actx.setTransform(fw / width, 0, 0, fw / width, 0, 0)

  const frame = document.createElement('canvas')
  frame.width = fw
  frame.height = fh
  const fctx = frame.getContext('2d')!

  const stream = frame.captureStream(fps)
  const recorder = new MediaRecorder(stream, {
    mimeType: picked.mimeType,
    videoBitsPerSecond: 8_000_000,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error('recording failed'))
  })

  const drawMs = Math.max(1, totalMs - holdMs)
  let drawn = 0

  const captionAt = (alpha: number) =>
    paintCaption(fctx, { width: fw, height: fh, seed, hands, alpha })

  // Recording is real-time and driven by requestAnimationFrame, which browsers
  // freeze in a background tab. Left unguarded that produces a file that is
  // mostly one held frame, with no error anywhere — so refuse up front and bail
  // the moment the tab goes away rather than hand back a broken artifact.
  if (document.hidden) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('bring this tab to the front first — recording needs it visible')
  }

  let hidden = false
  const onHide = () => {
    if (document.hidden) hidden = true
  }
  document.addEventListener('visibilitychange', onHide)

  recorder.start()
  const started = performance.now()

  try {
    await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) {
        reject(new Error('cancelled'))
        return
      }
      if (hidden) {
        reject(new Error('the tab went to the background — the timelapse needs it in front'))
        return
      }
      const elapsed = performance.now() - started
      const target = Math.min(
        timeline.total,
        Math.round((Math.min(1, elapsed / drawMs) ** 0.92) * timeline.total),
      )
      if (target > drawn) {
        paintRange(actx, timeline, drawn, target)
        drawn = target
      }

      fctx.setTransform(1, 0, 0, 1, 0, 0)
      fctx.drawImage(art, 0, 0)

      // The caption only appears once the drawing has finished, so it never
      // sits on top of a stroke that is still being made.
      const intoHold = elapsed - drawMs
      captionAt(Math.max(0, Math.min(1, intoHold / 700)))

      onProgress?.(Math.min(1, elapsed / totalMs))

      if (elapsed >= totalMs) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    })
  } catch (e) {
    document.removeEventListener('visibilitychange', onHide)
    if (recorder.state !== 'inactive') recorder.stop()
    stream.getTracks().forEach((t) => t.stop())
    throw e
  }

  document.removeEventListener('visibilitychange', onHide)
  recorder.stop()
  stream.getTracks().forEach((t) => t.stop())
  await finished

  return {
    blob: new Blob(chunks, { type: picked.mimeType }),
    extension: picked.extension,
    mimeType: picked.mimeType,
  }
}

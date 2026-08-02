import { expect, test } from '@playwright/test'

interface Result {
  mimeType: string | null
  extension: string | null
  bytes: number
  type: string
  wallMs: number
  lastProgress: number
  totalMs: number
  error?: string
}

/**
 * The timelapse export is the shareable artifact, so it gets a real assertion
 * rather than a hopeful click-through.
 *
 * It runs here and not in the app preview for a concrete reason: recording is
 * driven by requestAnimationFrame, which browsers freeze in a background tab.
 * Playwright's page is genuinely visible, so this is the only place the path
 * can actually be exercised. The shortened duration keeps the test quick —
 * recording is real-time by nature.
 */
test('the timelapse exports a real video file', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  await page.goto('/')

  const result = await page.evaluate<Result>(async () => {
    const video = await import('/src/engine/video.ts')
    const picked = video.pickMimeType()
    if (!picked) {
      return {
        mimeType: null, extension: null, bytes: 0, type: '',
        wallMs: 0, lastProgress: 0, totalMs: 0,
        error: 'no supported mime type',
      }
    }

    // Two layers of plain strokes — this test is about the recorder, not the
    // artwork; replay fidelity is covered by the pixel-exact suite.
    const layers = [1, 2].map((slotIndex) => ({
      slotIndex,
      strokes: [0, 1, 2].map((k) => ({
        color: '#1B1A17',
        size: 1,
        t0: k * 100,
        ink: 400,
        pts: Array.from({ length: 60 }, (_, i) => ({
          x: 200 + i * 25,
          y: 300 + slotIndex * 400 + k * 120 + Math.sin(i / 6) * 60,
          w: 9,
          t: i * 16,
        })),
      })),
    }))

    const totalMs = 4000
    let lastProgress = 0
    const t0 = performance.now()
    const out = await video.renderTimelapseVideo({
      layers,
      width: 2048,
      height: 2048,
      seed: 'low tide',
      hands: layers.length,
      totalMs,
      holdMs: 1200,
      maxDim: 540,
      onProgress: (p: number) => {
        lastProgress = p
      },
    })

    return {
      mimeType: picked.mimeType,
      extension: picked.extension,
      bytes: out.blob.size,
      type: out.blob.type,
      wallMs: Math.round(performance.now() - t0),
      lastProgress,
      totalMs,
    }
  })

  expect(pageErrors, 'page errors during the render').toEqual([])
  expect(result.error).toBeUndefined()

  // MP4 is what a share sheet expects; WebM is the accepted fallback.
  expect(result.type).toMatch(/^video\/(mp4|webm)/)
  expect(result.extension).toMatch(/^(mp4|webm)$/)

  // A file that exists and has frames in it, not an empty container.
  expect(result.bytes, 'video is suspiciously small').toBeGreaterThan(5_000)

  // Recording is real-time, so the wall clock is the duration.
  expect(result.wallMs).toBeGreaterThan(result.totalMs * 0.8)
  expect(result.wallMs).toBeLessThan(result.totalMs * 2.5)

  // And it ran to the end rather than stopping when the strokes ran out —
  // the hold on the finished piece is the point.
  expect(result.lastProgress).toBeGreaterThan(0.98)
})

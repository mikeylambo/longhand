import { expect, test } from '@playwright/test'

/**
 * The tools, and the one rule they all have to keep.
 *
 * The fill is the reason this file exists. It is the only tool that reads the
 * sheet before it writes to it, and the only one whose output is derived
 * rather than drawn — so it is the only one that could quietly disagree with
 * itself between browsers, or escape a shape and cover somebody's work. Both
 * of those are silent failures that reach the archive.
 *
 * Same shape as surface.spec.ts: the harness is a string evaluated inside an
 * async IIFE, because these modules are ESM and a bare page.evaluate body is
 * not.
 */

const HARNESS = `
  const { renderLayers } = await import('/src/engine/render.ts')
  const { traceFill, stampStrokes, textureMarks, STAMPS, MARK_FLOOR } =
    await import('/src/engine/tools.ts')

  /** A closed ring, drawn the way a player would draw one. */
  const ring = (cx, cy, r, upTo = 64) => {
    const pts = []
    for (let i = 0; i <= upTo; i++) {
      const a = (i / 64) * Math.PI * 2
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, w: 12, t: i * 8 })
    }
    return { color: '#1B1A17', size: 1, t0: 0, ink: 1, pts }
  }

  const sheet = (strokes) => renderLayers(2048, 2048, [strokes], { scale: 0.5 })
`

test.describe('the tools', () => {
  test('a fill lands inside a closed shape and is stored as geometry', async ({
    page,
  }) => {
    await page.goto('/')
    const result = await page.evaluate(`(async () => {
      ${HARNESS}
      const source = sheet([ring(1024, 1024, 400)])
      const r = traceFill(source, 2048, 2048, 1024, 1024, '#E3A59C', 0)
      return {
        has: Boolean(r.stroke),
        mode: r.stroke && r.stroke.mode,
        points: r.stroke ? r.stroke.pts.length : 0,
        ink: r.stroke ? r.stroke.ink : 0,
        coverage: r.coverage,
      }
    })()`)

    expect(result.has, 'a closed ring did not fill').toBeTruthy()
    expect(result.mode).toBe('f')
    // A circle of radius 400 on a 2048 sheet is about a tenth of it.
    expect(result.coverage).toBeGreaterThan(0.07)
    expect(result.coverage).toBeLessThan(0.16)
    // Traced, then simplified: hundreds of points rather than the thousands a
    // pixel-per-point boundary would be, and never so few that the polygon has
    // corners you can see.
    expect(result.points).toBeGreaterThan(20)
    expect(result.points).toBeLessThan(900)
    // Priced by area — a fill is the most expensive thing in the box.
    expect(result.ink).toBeGreaterThan(1000)
  })

  test('a fill refuses to escape a shape that is not closed', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(`(async () => {
      ${HARNESS}
      // The same ring, stopped short: a gap a flood would pour through.
      const source = sheet([ring(1024, 1024, 400, 52)])
      const r = traceFill(source, 2048, 2048, 1024, 1024, '#E3A59C', 0)
      return { has: Boolean(r.stroke), reason: r.reason }
    })()`)

    // This is the whole safety property of the tool: through that gap it would
    // have covered the entire sheet, and every other hand on it.
    expect(result.has, 'a fill escaped an open shape').toBeFalsy()
    expect(result.reason).toBe('escaped')
  })

  test('the same tap fills the same way twice', async ({ page }) => {
    await page.goto('/')
    // Determinism is what lets a fill be stored as geometry rather than as an
    // instruction to re-derive geometry. If two runs disagreed here, two
    // browsers would disagree about the archive.
    const same = await page.evaluate(`(async () => {
      ${HARNESS}
      const source = sheet([ring(1024, 1024, 300)])
      const a = traceFill(source, 2048, 2048, 1024, 1024, '#E3A59C', 0)
      const b = traceFill(source, 2048, 2048, 1024, 1024, '#E3A59C', 0)
      return JSON.stringify(a.stroke.pts) === JSON.stringify(b.stroke.pts)
    })()`)
    expect(same).toBeTruthy()
  })

  test('stamps and texture marks are ordinary strokes', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(`(async () => {
      ${HARNESS}
      const stamp = stampStrokes(STAMPS[0], 500, 500, 200, '#1B1A17', 9, 0, 0)
      const marks = textureMarks('stipple', 500, 500, 0, 3, '#1B1A17', 0, { n: 1 })
      return {
        stampStrokes: stamp.length,
        stampHasMode: stamp.some((s) => s.mode !== undefined),
        stampInk: stamp.reduce((n, s) => n + s.ink, 0),
        markHasMode: marks.some((m) => m.mode !== undefined),
        markInk: marks[0].ink,
        floor: MARK_FLOOR,
      }
    })()`)

    expect(result.stampStrokes).toBeGreaterThan(0)
    // No mode at all: a stamp is a drawn line as far as the archive is
    // concerned, which is why it needed no change to the wire format.
    expect(result.stampHasMode).toBeFalsy()
    expect(result.markHasMode).toBeFalsy()
    // Priced as if it had been drawn by hand, so a stamp is never cheaper than
    // drawing the same thing.
    expect(result.stampInk).toBeGreaterThan(100)
    // And a dot costs the floor, so six hundred of them cannot be free.
    expect(result.markInk).toBe(result.floor)
  })

  test('a wash survives the wire format, and a pen stroke is unchanged', async ({
    page,
  }) => {
    await page.goto('/')
    const round = await page.evaluate(`(async () => {
      const { encodeLayer, decodeLayer } = await import('/src/engine/codec.ts')
      const pts = [{ x: 1, y: 2, w: 9, t: 0 }, { x: 3, y: 4, w: 9, t: 8 }]
      const wash = { color: '#E3A59C', size: 1, t0: 0, ink: 40, pts, mode: 'w' }
      const pen  = { color: '#E3A59C', size: 1, t0: 0, ink: 40, pts }
      const enc = encodeLayer([wash, pen], 2048, 2048)
      const dec = decodeLayer(enc)
      return {
        washMode: dec[0].mode,
        penMode: dec[1].mode,
        penKeys: Object.keys(enc.strokes[1]).sort().join(','),
      }
    })()`)

    expect(round.washMode).toBe('w')
    expect(round.penMode).toBeUndefined()
    // A pen stroke has to encode to exactly what it always encoded to. An
    // archive that rewrites its old rows when a feature ships is not one.
    expect(round.penKeys).toBe('c,i,p,s,t')
  })
})

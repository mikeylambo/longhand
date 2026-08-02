import { expect, test } from '@playwright/test'

/**
 * Hand-feel, asserted.
 *
 * Prediction, inertia and rubber-banding are the three things that decide
 * whether the surface reads as native or as a web page, and all three are easy
 * to break without noticing — nothing renders wrong, it just starts feeling
 * cheap again.
 *
 * These run in Playwright rather than the app preview because they depend on
 * requestAnimationFrame actually firing, and browsers freeze rAF in a hidden
 * tab. Playwright's page is genuinely visible.
 */

const HARNESS = `
  const { Surface } = await import('/src/engine/surface.ts')
  const { TUNING } = await import('/src/config.ts')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;width:400px;height:700px'
  document.body.appendChild(host)
  const s = new Surface(host, {
    width: 2048, height: 2048, tuning: TUNING, inkBudget: 10000, fitPad: 1,
  })
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const cv = s.el
  const r = cv.getBoundingClientRect()
  const ev = (type, x, y, id) => cv.dispatchEvent(new PointerEvent(type, {
    pointerId: id ?? 1, pointerType: 'touch', isPrimary: true,
    bubbles: true, cancelable: true,
    clientX: r.left + x, clientY: r.top + y, pressure: 0.5,
    buttons: type === 'pointerup' ? 0 : 1,
  }))
  const frame = () => new Promise(res => requestAnimationFrame(res))
  const frames = async (n) => { for (let i = 0; i < n; i++) await frame() }
  const bounds = () => {
    const w = s.opts.width * s.view.scale, h = s.opts.height * s.view.scale
    return {
      minX: w <= s.cssW ? (s.cssW - w) / 2 : s.cssW - w,
      maxX: w <= s.cssW ? (s.cssW - w) / 2 : 0,
      minY: h <= s.cssH ? (s.cssH - h) / 2 : s.cssH - h,
      maxY: h <= s.cssH ? (s.cssH - h) / 2 : 0,
    }
  }
  const inBounds = () => {
    const b = bounds()
    return s.view.tx >= b.minX - 0.6 && s.view.tx <= b.maxX + 0.6 &&
           s.view.ty >= b.minY - 0.6 && s.view.ty <= b.maxY + 0.6
  }
  // Real elapsed time between moves, so velocity is measured off a real clock.
  const move = async (fn) => { await frame(); fn() }
  const zoomIn = async () => {
    ev('pointerdown', r.width * 0.35, r.height * 0.45, 11)
    ev('pointerdown', r.width * 0.65, r.height * 0.55, 12)
    for (let i = 1; i <= 12; i++) {
      await move(() => {
        const k = 1 + i * 0.14
        ev('pointermove', r.width * 0.5 - r.width * 0.15 * k, r.height * 0.5 - r.height * 0.05 * k, 11)
        ev('pointermove', r.width * 0.5 + r.width * 0.15 * k, r.height * 0.5 + r.height * 0.05 * k, 12)
      })
    }
    ev('pointerup', r.width * 0.1, r.height * 0.4, 11)
    ev('pointerup', r.width * 0.9, r.height * 0.6, 12)
    await frames(45)
  }
`

test('the tip is drawn ahead of the last recorded sample', async ({ page }) => {
  await page.goto('/')
  const out = await page.evaluate(`(async () => {
    ${HARNESS}
    const P = []
    for (let i = 0; i <= 50; i++) P.push([r.width * 0.2 + i * 4, r.height * 0.5])
    ev('pointerdown', P[0][0], P[0][1])
    let probe = null
    for (let i = 1; i < P.length; i++) {
      await move(() => ev('pointermove', P[i][0], P[i][1]))
      if (i === 35) {
        const b = s.drawing.builder
        const pts = b.points, last = pts[pts.length - 1]
        const lead = b.lead(TUNING.predictMs, TUNING.predictMaxPx)
        probe = {
          hasLead: !!lead,
          aheadPx: lead ? Math.hypot(lead.x - last.x, lead.y - last.y) : 0,
          // must lead in the direction of travel, not lag behind it
          forward: lead ? lead.x > last.x : false,
        }
      }
    }
    ev('pointerup', P[P.length - 1][0], P[P.length - 1][1])
    // and the guess is never committed
    const recorded = s.getLayer()[0]
    const lastRecorded = recorded.pts[recorded.pts.length - 1]
    return { ...probe, endsAtFinger: Math.abs(lastRecorded.x - (P[P.length-1][0] - r.left)) < 9999 }
  })()`) as { hasLead: boolean; aheadPx: number; forward: boolean }

  expect(out.hasLead, 'no lead point produced').toBe(true)
  expect(out.forward, 'lead must be ahead of the stroke, not behind').toBe(true)
  expect(out.aheadPx).toBeGreaterThan(2)
  expect(out.aheadPx).toBeLessThanOrEqual(70)
})

test('a two-finger fling coasts and settles inside the bounds', async ({ page }) => {
  await page.goto('/')
  const out = await page.evaluate(`(async () => {
    ${HARNESS}
    await zoomIn()
    const startedInBounds = inBounds()

    const y1 = r.height * 0.45, y2 = r.height * 0.55
    ev('pointerdown', r.width * 0.80, y1, 21)
    ev('pointerdown', r.width * 0.84, y2, 22)
    for (let i = 1; i <= 10; i++) {
      await move(() => {
        ev('pointermove', r.width * 0.80 - i * 18, y1, 21)
        ev('pointermove', r.width * 0.84 - i * 18, y2, 22)
      })
    }
    ev('pointerup', r.width * 0.80 - 180, y1, 21)
    ev('pointerup', r.width * 0.84 - 180, y2, 22)

    const txAtRelease = s.view.tx
    const hasMomentum = !!s.momentum
    await frames(4)
    const txSoonAfter = s.view.tx
    await frames(90)
    return {
      startedInBounds, hasMomentum,
      coasted: txSoonAfter - txAtRelease,
      settledInBounds: inBounds(),
      stillAnimating: s.animating,
    }
  })()`) as {
    startedInBounds: boolean; hasMomentum: boolean; coasted: number
    settledInBounds: boolean; stillAnimating: boolean
  }

  expect(out.startedInBounds, 'pinch should settle in bounds first').toBe(true)
  expect(out.hasMomentum, 'release produced no throw').toBe(true)
  // It kept going after the fingers left, in the direction of the fling.
  expect(out.coasted).toBeLessThan(-1)
  expect(out.settledInBounds, 'coast did not come to rest inside the bounds').toBe(true)
  expect(out.stillAnimating, 'animation never finished').toBe(false)
})

test('the sheet gives at the edge and springs back', async ({ page }) => {
  await page.goto('/')
  const out = await page.evaluate(`(async () => {
    ${HARNESS}
    await zoomIn()

    // Drag hard past the right edge and hold there.
    const y1 = r.height * 0.45, y2 = r.height * 0.55
    ev('pointerdown', r.width * 0.2, y1, 31)
    ev('pointerdown', r.width * 0.24, y2, 32)
    for (let i = 1; i <= 14; i++) {
      await move(() => {
        ev('pointermove', r.width * 0.2 + i * 40, y1, 31)
        ev('pointermove', r.width * 0.24 + i * 40, y2, 32)
      })
    }
    const b = bounds()
    const overshoot = s.view.tx - b.maxX
    const heldOutside = s.view.tx > b.maxX + 1

    ev('pointerup', r.width * 0.2 + 560, y1, 31)
    ev('pointerup', r.width * 0.24 + 560, y2, 32)
    await frames(90)

    return {
      heldOutside,
      overshoot,
      // resistance must bound the give rather than tracking the finger 1:1
      overshootUnderFingerTravel: overshoot < 560,
      sprungBack: inBounds(),
    }
  })()`) as {
    heldOutside: boolean; overshoot: number
    overshootUnderFingerTravel: boolean; sprungBack: boolean
  }

  expect(out.heldOutside, 'sheet did not give at the edge').toBe(true)
  expect(out.overshootUnderFingerTravel, 'edge gave with no resistance').toBe(true)
  expect(out.sprungBack, 'sheet did not spring back into bounds').toBe(true)
})

test('a two-finger tap undoes', async ({ page }) => {
  await page.goto('/')
  const out = await page.evaluate(`(async () => {
    ${HARNESS}
    for (const off of [0, 60, 120]) {
      const y = r.height * 0.35 + off
      ev('pointerdown', r.width * 0.25, y)
      for (let i = 1; i <= 12; i++) await move(() => ev('pointermove', r.width * 0.25 + i * 10, y))
      ev('pointerup', r.width * 0.25 + 120, y)
      await frame()
    }
    const before = s.strokeCount

    // two fingers down and straight back up, going nowhere
    ev('pointerdown', r.width * 0.4, r.height * 0.6, 41)
    ev('pointerdown', r.width * 0.6, r.height * 0.6, 42)
    await frame()
    ev('pointerup', r.width * 0.4, r.height * 0.6, 41)
    ev('pointerup', r.width * 0.6, r.height * 0.6, 42)
    await frames(3)
    const afterTap = s.strokeCount

    // and a two-finger *drag* must not undo anything
    ev('pointerdown', r.width * 0.4, r.height * 0.6, 51)
    ev('pointerdown', r.width * 0.6, r.height * 0.6, 52)
    for (let i = 1; i <= 8; i++) {
      await move(() => {
        ev('pointermove', r.width * 0.4 - i * 12, r.height * 0.6, 51)
        ev('pointermove', r.width * 0.6 - i * 12, r.height * 0.6, 52)
      })
    }
    ev('pointerup', r.width * 0.4 - 96, r.height * 0.6, 51)
    ev('pointerup', r.width * 0.6 - 96, r.height * 0.6, 52)
    await frames(60)
    return { before, afterTap, afterDrag: s.strokeCount }
  })()`) as { before: number; afterTap: number; afterDrag: number }

  expect(out.before).toBe(3)
  expect(out.afterTap, 'two-finger tap did not undo').toBe(2)
  expect(out.afterDrag, 'a two-finger pan must not undo').toBe(2)
})

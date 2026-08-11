import { expect, test } from '@playwright/test'

/**
 * A turn in progress survives the page going away.
 *
 * The failure this guards is the one nobody sees in development: strokes lived
 * only in the surface's memory, so a reload resumed the turn — same slot, same
 * clock — with an empty sheet. On a phone it does not take a deliberate
 * reload, because iOS discards backgrounded tabs.
 *
 * Driven through the real app rather than against the Surface directly. The
 * saving, the restoring and the clearing are wiring between DrawTurn, App and
 * the draft store, and a test that constructed a Surface itself would exercise
 * none of it.
 *
 * Runs without a database: in local mode the relay is faked and the draft key
 * is the same code path.
 */

const phone = { width: 390, height: 844 }
test.use({ viewport: phone })

/**
 * Local mode mints a fresh turn on every load — `LocalSession.join` sets
 * `expiresAt` to now plus ten minutes each time — so without this a reload is
 * genuinely a different turn and refusing the draft is the correct answer.
 * The ledger resumes the same turn with the same expiry, which is the case
 * worth testing; freezing the clock makes local mode behave that way too.
 */
async function freezeTheClock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const fixed = 1786000000000
    Date.now = () => fixed
  })
}

/** Welcome, sign, and arrive on a sheet. */
async function reachTheSheet(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add yours' }).click()
  await expect(page.getByRole('heading', { name: 'Your mark' })).toBeVisible()

  await scribble(page, 0.5, 0.35)
  const mark = page.getByRole('button', { name: 'This is my mark' })
  await expect(mark).toBeEnabled()
  await mark.click()

  await expect(page.getByRole('button', { name: /Finish|Saving/ })).toBeVisible()
}

/**
 * One stroke, on the drawing surface.
 *
 * PointerEvents dispatched at the element rather than page.mouse: the surface
 * listens for pointers and reads `pointerType`, and synthetic mouse input
 * never reaches it. A frame between moves so velocity is measured off a real
 * clock, which is what decides whether a stroke has width.
 */
async function scribble(
  page: import('@playwright/test').Page,
  cx: number,
  cy: number,
) {
  await page.evaluate(
    async ([fx, fy]) => {
      // The biggest canvas on screen is the sheet; swatches and clips are small.
      const cv = [...document.querySelectorAll('canvas')].sort(
        (a, b) =>
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height,
      )[0]
      const r = cv.getBoundingClientRect()
      const ev = (type: string, x: number, y: number) =>
        cv.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: r.left + x,
            clientY: r.top + y,
            pressure: 0.5,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        )
      const frame = () => new Promise((res) => requestAnimationFrame(res))

      const x0 = r.width * (fx as number) - 60
      const y0 = r.height * (fy as number)
      ev('pointerdown', x0, y0)
      for (let i = 1; i <= 12; i++) {
        await frame()
        ev('pointermove', x0 + i * 10, y0 + (i % 2) * 6)
      }
      ev('pointerup', x0 + 120, y0)
      await frame()
    },
    [cx, cy],
  )
  await page.waitForTimeout(120)
}

test('an unsubmitted drawing survives a reload', async ({ page }) => {
  await freezeTheClock(page)
  await reachTheSheet(page)

  const finish = page.getByRole('button', { name: 'Finish' })
  await expect(finish, 'a fresh turn should have nothing to finish').toBeDisabled()

  await scribble(page, 0.5, 0.5)
  await expect(finish, 'the stroke did not land').toBeEnabled()

  // Past the save debounce, then away.
  await page.waitForTimeout(700)
  await page.reload()

  // Same turn, and the work is still on it.
  const finishAgain = page.getByRole('button', { name: 'Finish' })
  await expect(finishAgain).toBeVisible()
  await expect(
    finishAgain,
    'the drawing was lost across a reload — the draft did not restore',
  ).toBeEnabled()

  const draft = await page.evaluate(() => localStorage.getItem('longhand.draft.v1'))
  expect(draft, 'no draft was written').not.toBeNull()
})

test('backgrounding the tab saves without waiting for the debounce', async ({ page }) => {
  await reachTheSheet(page)
  await scribble(page, 0.4, 0.45)

  // Straight to hidden, well inside the debounce window.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  const draft = await page.evaluate(() => localStorage.getItem('longhand.draft.v1'))
  expect(draft, 'a tab going to the background did not flush the draft').not.toBeNull()
})

test('a submitted turn leaves no draft behind', async ({ page }) => {
  await reachTheSheet(page)
  await scribble(page, 0.5, 0.5)
  await page.waitForTimeout(700)

  expect(
    await page.evaluate(() => localStorage.getItem('longhand.draft.v1')),
    'nothing was saved to begin with, so this proves nothing',
  ).not.toBeNull()

  await page.getByRole('button', { name: 'Finish' }).click()

  // The review screen is the proof the submit went through.
  await expect(page.getByRole('heading', { name: /yours is on it|canvas complete/i }))
    .toBeVisible({ timeout: 10_000 })

  expect(
    await page.evaluate(() => localStorage.getItem('longhand.draft.v1')),
    'the draft outlived the layer it was a copy of',
  ).toBeNull()
})

test('a draft from another turn is refused, not painted onto a fresh one', async ({
  page,
}) => {
  await freezeTheClock(page)
  await reachTheSheet(page)
  await scribble(page, 0.5, 0.5)
  await page.waitForTimeout(700)

  // Leave the sheet before touching storage. Navigating fires `pagehide`,
  // which flushes the draft under its real key — so relabelling first would be
  // undone by the app's own save on the way out, and the test would silently
  // be asserting nothing.
  await page.goto('/terms')

  // Keep the real drawing but re-label it as belonging to some other turn —
  // the shape of a slot that expired and was claimed again later.
  const rewritten = await page.evaluate(() => {
    const raw = localStorage.getItem('longhand.draft.v1')
    if (!raw) return false
    const d = JSON.parse(raw)
    d.turn = `${d.turn}-not-this-turn`
    localStorage.setItem('longhand.draft.v1', JSON.stringify(d))
    return true
  })
  expect(rewritten, 'there was no draft to relabel').toBe(true)

  await page.goto('/')

  const finish = page.getByRole('button', { name: 'Finish' })
  await expect(finish).toBeVisible()
  await expect(
    finish,
    "another turn's drawing was restored onto this one",
  ).toBeDisabled()
})

test('a draft drawn on a different sheet size is refused', async ({ page }) => {
  await freezeTheClock(page)
  await reachTheSheet(page)
  await scribble(page, 0.5, 0.5)
  await page.waitForTimeout(700)

  // Off the sheet first, for the same reason as above: leaving flushes.
  await page.goto('/terms')

  // Same turn, but the coordinates now mean something else.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('longhand.draft.v1')!)
    d.layer.w = d.layer.w + 512
    localStorage.setItem('longhand.draft.v1', JSON.stringify(d))
  })

  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Finish' }),
    'strokes from a differently sized sheet were restored at the wrong scale',
  ).toBeDisabled()
})

import { expect, test } from '@playwright/test'

/**
 * What a slot costs, and how to stop paying it.
 *
 * Both of these came out of playtesting on a phone rather than from reading
 * the code, and both waste a slot for everybody else on the canvas: a single
 * tap could be submitted as a layer, and once a slot was claimed there was no
 * way out of it short of letting the ten-minute clock run down.
 */

const phone = { width: 390, height: 844 }
test.use({ viewport: phone })

/** The sheet, or the signature pad — whichever is the biggest canvas on screen. */
async function pointer(
  page: import('@playwright/test').Page,
  moves: number,
  step = 10,
) {
  await page.evaluate(
    async ([n, px]) => {
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
      const x0 = r.width * 0.3
      const y0 = r.height * 0.5
      ev('pointerdown', x0, y0)
      for (let i = 1; i <= (n as number); i++) {
        await frame()
        ev('pointermove', x0 + i * (px as number), y0)
      }
      ev('pointerup', x0 + (n as number) * (px as number), y0)
      await frame()
    },
    [moves, step],
  )
  await page.waitForTimeout(120)
}

async function reachTheSheet(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add yours' }).click()
  await expect(page.getByRole('heading', { name: 'Your mark' })).toBeVisible()
  await pointer(page, 12)
  await page.getByRole('button', { name: 'This is my mark' }).click()
  await expect(page.getByRole('button', { name: /Finish|Saving/ })).toBeVisible()
}

test('a tap cannot spend a slot, and says so', async ({ page }) => {
  await reachTheSheet(page)
  const finish = page.getByRole('button', { name: 'Finish' })
  await expect(finish).toBeDisabled()

  // A tap: pointer down and up with no travel between them.
  await pointer(page, 0)

  await expect(
    finish,
    'a single tap was enough to finish, which spends somebody a slot',
  ).toBeDisabled()
  // And the reason is on screen, because a disabled button with no explanation
  // is the most annoying thing an interface can do.
  await expect(page.getByText(/a little more than that/i)).toBeVisible()
})

test('a drawn line is enough', async ({ page }) => {
  await reachTheSheet(page)
  await pointer(page, 12)
  await expect(
    page.getByRole('button', { name: 'Finish' }),
    'a real stroke should be over the floor',
  ).toBeEnabled()
  await expect(page.getByText(/a little more than that/i)).toHaveCount(0)
})

test('the slot can be handed back', async ({ page }) => {
  await reachTheSheet(page)

  // Nothing drawn: one tap, no confirmation, because there is nothing to lose.
  await page.getByRole('button', { name: 'Give the slot back' }).click()
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
})

test('handing back a slot with work on it asks first', async ({ page }) => {
  await reachTheSheet(page)
  await pointer(page, 12)

  const leave = page.getByRole('button', { name: 'Give the slot back' })
  await leave.click()

  // Still on the sheet, and now asking.
  const armed = page.getByRole('button', { name: /Sure\?/ })
  await expect(armed, 'leaving with a drawing on the sheet did not confirm').toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible()

  await armed.click()
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
})

test('the sheet zooms out past fit, and fit is dead only when fitted', async ({
  page,
}) => {
  await reachTheSheet(page)

  const fit = page.getByRole('button', { name: 'Fit the whole canvas' })
  await expect(fit, 'fit should be unavailable when already fitted').toBeDisabled()

  const out = await page.evaluate(async () => {
    const s = (window as unknown as { __lh?: {
      zoom: number
      fit(): void
      el: HTMLCanvasElement
    } }).__lh
    if (!s) return null
    const fitted = s.zoom
    // Pinch out, well past what the old floor allowed.
    const r = s.el.getBoundingClientRect()
    const ev = (type: string, x: number, y: number, id: number) =>
      s.el.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 41,
        bubbles: true, cancelable: true,
        clientX: r.left + x, clientY: r.top + y, pressure: 0.5,
        buttons: type === 'pointerup' ? 0 : 1,
      }))
    const frame = () => new Promise((res) => requestAnimationFrame(res))
    ev('pointerdown', r.width * 0.2, r.height * 0.5, 41)
    ev('pointerdown', r.width * 0.8, r.height * 0.5, 42)
    for (let i = 1; i <= 14; i++) {
      await frame()
      const k = 1 - i * 0.05
      ev('pointermove', r.width * (0.5 - 0.3 * k), r.height * 0.5, 41)
      ev('pointermove', r.width * (0.5 + 0.3 * k), r.height * 0.5, 42)
    }
    ev('pointerup', r.width * 0.5, r.height * 0.5, 41)
    ev('pointerup', r.width * 0.5, r.height * 0.5, 42)
    for (let i = 0; i < 50; i++) await frame()
    return { fitted, after: s.zoom }
  })

  expect(out, 'the dev handle was not exposed').not.toBeNull()
  expect(
    out!.after,
    'the sheet would not go smaller than fit — the old floor is still there',
  ).toBeLessThan(out!.fitted)
  // And not to a postage stamp.
  expect(out!.after).toBeGreaterThan(out!.fitted * 0.6)

  await expect(fit, 'fit should be live once the view has moved').toBeEnabled()
})

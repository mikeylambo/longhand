import { expect, test } from '@playwright/test'

/**
 * The first turn, taught one thing at a time.
 *
 * What is worth guarding is not that the sentences appear — it is that they
 * appear *once*, in order, never on top of each other, and never again to
 * somebody who has already taken a turn. A coach that forgets it has spoken is
 * the failure mode people actually complain about.
 */

const phone = { width: 390, height: 844 }
test.use({ viewport: phone })

const KEY = 'longhand.coached.v1'

async function pointer(page: import('@playwright/test').Page, moves: number) {
  await page.evaluate(async (n) => {
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
    const x0 = r.width * 0.25
    const y0 = r.height * (0.3 + Math.random() * 0.4)
    ev('pointerdown', x0, y0)
    for (let i = 1; i <= n; i++) {
      await frame()
      ev('pointermove', x0 + i * 10, y0)
    }
    ev('pointerup', x0 + n * 10, y0)
    await frame()
  }, moves)
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

/** Start the turn with some lessons already behind you. */
async function alreadySeen(page: import('@playwright/test').Page, ids: string[]) {
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [KEY, JSON.stringify(ids)],
  )
}

test('the first thing taught is the control that is not on screen', async ({ page }) => {
  await reachTheSheet(page)
  await expect(page.getByText('Two fingers to move and zoom')).toBeVisible()
  // One at a time: the permanence lesson has not jumped the queue.
  await expect(page.getByText(/cannot be rubbed out|rubbed out/i)).toHaveCount(0)
})

test('the permanence rule arrives with the first stroke, not before it', async ({
  page,
}) => {
  await alreadySeen(page, ['move'])
  await reachTheSheet(page)

  // Nothing drawn yet, so there is nothing to be permanent about.
  await expect(page.getByText(/rubbed out/i)).toHaveCount(0)

  await pointer(page, 12)
  await expect(page.getByText(/rubbed out/i)).toBeVisible()
})

test('a lesson yields to the reason a button is disabled', async ({ page }) => {
  await alreadySeen(page, ['move'])
  await reachTheSheet(page)

  // A tap: enough to make the permanence lesson eligible, not enough to finish.
  await pointer(page, 0)

  await expect(page.getByText(/a little more than that/i)).toBeVisible()
  await expect(
    page.getByText(/rubbed out/i),
    'a lesson was shown over the reason Finish is disabled',
  ).toHaveCount(0)
})

test('each lesson is shown once, and never on a later turn', async ({ page }) => {
  await reachTheSheet(page)
  await expect(page.getByText('Two fingers to move and zoom')).toBeVisible()

  // Finish the turn: that is what marks somebody as taught.
  await pointer(page, 12)
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(
    page.getByRole('heading', { name: /yours is on it|that closed it/i }),
  ).toBeVisible({ timeout: 10_000 })

  const stored = await page.evaluate((k) => localStorage.getItem(k), KEY)
  expect(stored, 'completing a turn did not end the coaching').toContain('tools')

  // A second turn is silent.
  await page.getByRole('button', { name: /Take the next slot|Draw on another/ }).click()
  await expect(page.getByRole('button', { name: /Finish|Saving/ })).toBeVisible()
  await expect(
    page.getByText('Two fingers to move and zoom'),
    'the second turn coached somebody who has already taken one',
  ).toHaveCount(0)

  await pointer(page, 12)
  await expect(page.getByText(/rubbed out/i)).toHaveCount(0)
})

test('handing the slot back does not count as having been taught', async ({ page }) => {
  await reachTheSheet(page)
  await expect(page.getByText('Two fingers to move and zoom')).toBeVisible()

  await page.getByRole('button', { name: 'Give the slot back' }).click()
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()

  const stored = await page.evaluate((k) => localStorage.getItem(k), KEY)
  expect(
    stored ?? '',
    'backing out of a first turn marked somebody as taught',
  ).not.toContain('tools')
})

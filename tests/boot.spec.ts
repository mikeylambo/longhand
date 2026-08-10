import { expect, test } from '@playwright/test'

/**
 * The handover from the splash.
 *
 * The failure this guards is invisible on a fast machine and unmissable on a
 * slow one: the wordmark comes down on a timer and uncovers `Finding you a
 * sheet…`, so opening the app is two waits instead of one. Locally the relay
 * answers instantly and nothing can go wrong, which is exactly why it needs a
 * test — the bug only exists on connections this machine does not have.
 *
 * So the wait is simulated rather than hoped for. `boot.ts` is imported into
 * the page before the app is, at the same URL the app imports it from, which
 * makes it the same module instance: a hold placed here is a hold the real
 * handover has to honour.
 */

const phone = { width: 390, height: 844 }
test.use({ viewport: phone })

/** Hold the splash open from before the app boots, optionally releasing. */
async function holdFor(page: import('@playwright/test').Page, ms: number | null) {
  await page.addInitScript((release) => {
    void import('/src/ui/boot.ts').then((m) => {
      m.holdSplash('spec', true)
      if (release !== null) setTimeout(() => m.holdSplash('spec', false), release)
    })
  }, ms)
}

test('holds are answers to a question, not locks to be paired up', async ({ page }) => {
  // A screen with nothing to wait for, so the app's own holds stay out of it.
  await page.goto('/terms')
  const result = await page.evaluate(async () => {
    const m = await import('/src/ui/boot.ts')
    const fired: string[] = []

    // Nothing held: a caller that arrives late is not left waiting forever.
    m.whenSplashClear(() => fired.push('immediate'))

    m.holdSplash('a', true)
    m.holdSplash('a', true) // saying it twice is still one hold
    m.whenSplashClear(() => fired.push('waited'))
    m.holdSplash('b', true)

    m.holdSplash('a', false)
    const midway = { fired: [...fired], holds: m.splashHolds() }

    m.holdSplash('b', false)
    return { midway, after: [...fired], holds: m.splashHolds() }
  })

  expect(result.midway.fired, 'the first caller was made to wait').toEqual(['immediate'])
  expect(result.midway.holds, 'saying it twice took two releases').toEqual(['b'])
  expect(result.after, 'the last release did not hand over').toEqual([
    'immediate',
    'waited',
  ])
  expect(result.holds).toEqual([])
})

test('the splash waits for the screen behind it, not for the clock', async ({
  page,
}) => {
  await holdFor(page, 2600)
  await page.goto('/')

  // Well past the floor, which is the moment it would have handed over before.
  await page.waitForTimeout(2000)
  await expect(
    page.locator('#boot'),
    'the splash handed over to whatever was behind it',
  ).toBeVisible()

  // And it does come down once the wait is over.
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 4000 })
})

test('a relay that never answers cannot hold anybody behind a logo', async ({
  page,
}) => {
  await holdFor(page, null)
  await page.goto('/')

  await page.waitForTimeout(2500)
  await expect(page.locator('#boot')).toBeVisible()

  // Past the ceiling the loading screen is the more honest thing to look at.
  await expect(
    page.locator('#boot'),
    'the ceiling did not fire, so a dead relay traps the app on the splash',
  ).toHaveCount(0, { timeout: 4000 })
})

test('the sheet declares itself as something worth waiting for', async ({ page }) => {
  // Locally the relay is instant, so the hold exists for a frame or two. That
  // it exists at all is the wiring; how long it lasts is the connection.
  await page.addInitScript(() => {
    const seen = new Set<string>()
    ;(window as unknown as { __holds: string[] }).__holds = []
    void import('/src/ui/boot.ts').then((m) => {
      const tick = () => {
        for (const h of m.splashHolds()) {
          if (!seen.has(h)) {
            seen.add(h)
            ;(window as unknown as { __holds: string[] }).__holds.push(h)
          }
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const holds = await page.evaluate(
    () => (window as unknown as { __holds: string[] }).__holds,
  )
  expect(holds, 'App never told the splash it was still finding a sheet').toContain(
    'sheet',
  )
})

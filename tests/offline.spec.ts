import { expect, test } from '@playwright/test'

/**
 * The offline strip.
 *
 * The two things that fail without a connection — claiming a slot, submitting a
 * turn — fail silently otherwise: a Finish that does nothing, a sheet that will
 * not load. This asserts the app says so, and stops saying so the moment the
 * connection is back, using Playwright's real offline emulation rather than a
 * stubbed `navigator.onLine`, so the `online`/`offline` events are the genuine
 * ones the component listens for.
 */

test.use({ viewport: { width: 390, height: 844 } })

const OFFLINE = /you.?re offline/i

test('a dropped connection says so, and takes the words back when it returns', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await expect(page.getByText(OFFLINE)).toHaveCount(0)

  await context.setOffline(true)
  await expect(page.getByText(OFFLINE)).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText(OFFLINE)).toHaveCount(0)
})

test('the strip is there on arrival if the connection is already down', async ({
  page,
}) => {
  // The component has to catch the state it mounted into, not only the change
  // events it might miss. Emulating that with setOffline is impossible against a
  // local dev server — offline blocks the page load itself, where the real PWA
  // would serve a cached shell — so navigator.onLine is made to report offline
  // while the document still loads, which is exactly the mount-time case.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  })
  await page.goto('/')
  await expect(page.getByText(OFFLINE)).toBeVisible()
})

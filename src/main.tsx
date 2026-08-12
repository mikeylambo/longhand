import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { CanvasPage } from './ui/CanvasPage'
import { Gallery } from './ui/Gallery'
import { DocPage } from './ui/DocPage'
import { MarkPage } from './ui/MarkPage'
import { HandPage } from './ui/HandPage'
import { WorldPage } from './ui/WorldPage'
import { ScreenPage } from './ui/ScreenPage'
import { ArPage } from './ui/ArPage'
import { ClassPage } from './ui/ClassPage'
import { DOCS } from './content/legal'
import { SelfTestPage } from './dev/SelfTestPage'
import { Router } from './ui/Router'
import { OfflineBanner } from './ui/OfflineBanner'
import { whenSplashClear } from './ui/boot'
import './styles.css'

/**
 * Which screen a path is.
 *
 * The URLs are real and always were: every route here is somewhere you can
 * arrive at from outside — a shared link, a notification — and that has not
 * changed. What changed is that moving *between* them no longer throws the
 * running app away. See `Router`; this function is unchanged apart from
 * taking the path rather than reading it.
 *
 * (This comment used to argue against a client router on the grounds that
 * every route is an arrival. True of arriving, wrong about moving around, and
 * it only became wrong once somebody meant to use this for an hour at a time.)
 */
function route(rawPath: string): ReactNode {
  const params = new URLSearchParams(location.search)
  if (params.get('selftest') === '1') return <SelfTestPage />

  const path = rawPath.replace(/\/+$/, '') || '/'
  if (path === '/gallery') return <Gallery />

  const doc = DOCS.find((d) => path === `/${d.slug}`)
  if (doc) return <DocPage doc={doc} />

  if (path === '/mark') return <MarkPage />
  if (path === '/world') return <WorldPage />
  if (path === '/screen') return <ScreenPage />
  if (path === '/class') return <ClassPage />

  const canvas = path.match(/^\/c\/([0-9a-f-]{36})$/i)
  if (canvas) return <CanvasPage canvasId={canvas[1]} />

  const hand = path.match(/^\/h\/([0-9a-f-]{36})$/i)
  if (hand) return <HandPage signatureId={hand[1]} />

  const view = path.match(/^\/ar\/([0-9a-f-]{36})$/i)
  if (view) return <ArPage canvasId={view[1]} />

  const gift = path.match(/^\/g\/([0-9a-zA-Z-]{8,64})$/)
  if (gift) return <App giftToken={gift[1]} />

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OfflineBanner />
    <Router render={route} />
  </StrictMode>,
)

/**
 * Hands over from the splash in index.html.
 *
 * Three conditions, in order: the app has painted at all, the splash has been
 * up long enough to have been a moment rather than a flicker, and the screen
 * behind it is a screen rather than another wait.
 *
 * The paint one waits two animation frames rather than dismissing on render,
 * because render only means React has built the tree — leaving there can
 * uncover an unpainted frame, which is the white flash the splash exists to
 * prevent.
 *
 * The floor exists because a fast connection was the ugly case: the wordmark
 * appeared and vanished inside a few hundred milliseconds, which reads as a
 * glitch, not as opening. It means a returning visitor sees the same opening
 * as a first-time one on a slow phone, and it is the one number here worth
 * tuning by feel.
 *
 * The third is `boot.ts`, and it is what stops the splash handing over to
 * `Finding you a sheet…` on a slow relay. The ceiling bounds it: a relay that
 * never answers must not be able to hold anybody behind a logo, and past a few
 * seconds the loading screen is the more honest thing to be looking at.
 */
const SPLASH_FLOOR_MS = 1400
const SPLASH_CEILING_MS = 4200
const splashShownAt = performance.now()

function dismissSplash() {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('done')
  const drop = () => boot.remove()
  boot.addEventListener('transitionend', drop, { once: true })
  // transitionend never fires under prefers-reduced-motion, where the
  // transition is none. Belt and braces, and harmless if it has already gone.
  setTimeout(drop, 600)
}

/** Whichever comes first: the screen behind is ready, or the ceiling. */
function handOver() {
  let gone = false
  const go = () => {
    if (gone) return
    gone = true
    dismissSplash()
  }
  whenSplashClear(go)
  setTimeout(go, Math.max(0, SPLASH_CEILING_MS - (performance.now() - splashShownAt)))
}

requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const waited = performance.now() - splashShownAt
    setTimeout(handOver, Math.max(0, SPLASH_FLOOR_MS - waited))
  }),
)

// Offline shell. Only in production — a service worker in front of the dev
// server turns every edit into a cache-invalidation puzzle.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* an app that works offline is a bonus, never a requirement */
    })
  })
}

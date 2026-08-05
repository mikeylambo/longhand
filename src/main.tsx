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
import './styles.css'

/**
 * Plain anchors and full page loads rather than a client router. Every route
 * here is a destination someone arrives at from outside — a shared link, a
 * notification — not a step in a flow, so there is nothing for a router to
 * preserve and no dependency worth carrying for it.
 */
function route(): ReactNode {
  const params = new URLSearchParams(location.search)
  if (params.get('selftest') === '1') return <SelfTestPage />

  const path = location.pathname.replace(/\/+$/, '') || '/'
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
  <StrictMode>{route()}</StrictMode>,
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

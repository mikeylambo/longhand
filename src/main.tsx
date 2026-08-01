import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { CanvasPage } from './ui/CanvasPage'
import { Gallery } from './ui/Gallery'
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

  const canvas = path.match(/^\/c\/([0-9a-f-]{36})$/i)
  if (canvas) return <CanvasPage canvasId={canvas[1]} />

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{route()}</StrictMode>,
)

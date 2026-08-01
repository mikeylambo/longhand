import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { SelfTestPage } from './dev/SelfTestPage'
import './styles.css'

const selftest = new URLSearchParams(location.search).get('selftest') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{selftest ? <SelfTestPage /> : <App />}</StrictMode>,
)

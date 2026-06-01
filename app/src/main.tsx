import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function log(msg: string) {
  const el = document.getElementById('debug-status')
  if (el) el.textContent = msg
  console.log('[BOOT]', msg)
}

try {
  log('Import OK')
  const rootEl = document.getElementById('root')
  if (!rootEl) {
    log('ERROR: #root not found')
    throw new Error('#root not found')
  }
  log('Found #root')

  // @ts-ignore
  if (rootEl._reactRoot) {
    log('Reusing existing root')
    // @ts-ignore
    rootEl._reactRoot.render(<App />)
  } else {
    log('Creating new root...')
    const root = createRoot(rootEl)
    // @ts-ignore
    rootEl._reactRoot = root
    log('Root created, rendering...')
    root.render(<App />)
    log('Render called')
  }
} catch (err: any) {
  log('FATAL: ' + (err?.message || String(err)))
  console.error('[BOOT] Fatal:', err)
}

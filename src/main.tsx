import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// After a new deploy, a still-open tab may try to lazy-load a chunk whose
// hashed name no longer exists on the server ("Failed to fetch dynamically
// imported module"). Vite fires this event on such a failure — reload once to
// pull the fresh index + chunks (guarded so it can't loop).
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('preload-reload-at') ?? 0)
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem('preload-reload-at', String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

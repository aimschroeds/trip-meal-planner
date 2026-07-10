// PWA install + offline-ready helpers (M-offline follow-up). The browser's
// automatic install prompt and the first-run "offline ready" toast are both
// one-shot — they don't reappear on later visits (or when opening a shared
// plan), and never fire inside messaging-app in-app browsers. These give the
// app durable, user-driven equivalents instead.

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Captured at module load so the (one-shot) event isn't missed before a
// component mounts.
let deferred: BeforeInstallPromptEvent | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

/** Already running as an installed app (home-screen / standalone). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** iOS Safari has no install prompt — the user must use Share → Add to Home. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
}

export function usePwaInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    subs.add(f)
    return () => {
      subs.delete(f)
    }
  }, [])
  return {
    canInstall: deferred !== null,
    async install() {
      if (!deferred) return
      await deferred.prompt()
      deferred = null
      notify()
    },
  }
}

/** True once a service worker controls the page — i.e. the app shell is cached
 *  and it will open with no connection. */
export function useOfflineReady(): boolean {
  const [ready, setReady] = useState(
    () => typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller,
  )
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const update = () => setReady(!!navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', update)
    void navigator.serviceWorker.ready.then(update)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', update)
  }, [])
  return ready
}

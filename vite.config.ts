/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: precache the app shell so the planner opens and works with no signal
    // on the trail (data already lives in IndexedDB). Installable to the home
    // screen; auto-updates to the latest build next time there's a connection.
    VitePWA({
      // 'prompt' (not autoUpdate): a new deploy does NOT skipWaiting/claim and
      // evict the running tab's lazy chunks out from under it (which caused
      // "Failed to fetch dynamically imported module"). Instead ReloadPrompt
      // shows a "new version — reload" banner; the old SW keeps serving the
      // current session's chunks until the user reloads.
      registerType: 'prompt',
      // Registration is done from the app (ReloadPrompt) so we can confirm
      // "ready to use offline".
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Hiking Trip Meal & Gear Planner',
        short_name: 'Trip Planner',
        description: 'Plan and pack food for multi-day hikes — works offline on the trail.',
        theme_color: '#065f46',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache everything the build emits (the whole app is small); this is
        // what makes it load offline. Lazy SDK chunks (sync/extract) are cached
        // too, though those features still need a connection to do anything.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})

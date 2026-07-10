import { useRegisterSW } from 'virtual:pwa-register/react'

// Registers the service worker and shows a brief, dismissible confirmation the
// first time the app is cached for offline use (and, if one ever surfaces, an
// update prompt). With registerType 'autoUpdate' new builds normally apply
// themselves next time there's a connection.
export function ReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!offlineReady && !needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[92%] rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm shadow-lg">
      {needRefresh ? (
        <span className="flex flex-wrap items-center gap-3">
          A new version is available.
          <button
            className="rounded bg-emerald-700 px-2 py-0.5 font-medium text-white"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
          <button className="text-gray-500 underline" onClick={() => setNeedRefresh(false)}>
            later
          </button>
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-3">
          <span>✅ Ready to use offline — your plan will open without a signal.</span>
          <button className="text-gray-500 underline" onClick={() => setOfflineReady(false)}>
            got it
          </button>
        </span>
      )}
    </div>
  )
}

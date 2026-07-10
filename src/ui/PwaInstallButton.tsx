import { useState } from 'react'
import { isIosSafari, isStandalone, usePwaInstall } from './usePwa'

// An always-available install affordance (unlike the browser's one-shot
// prompt). Hidden once installed or where install isn't possible.
export function PwaInstallButton() {
  const { canInstall, install } = usePwaInstall()
  const [showHint, setShowHint] = useState(false)

  if (isStandalone()) return null
  const ios = isIosSafari()
  if (!canInstall && !ios) return null

  return (
    <div className="relative">
      <button
        className="rounded border border-emerald-700 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
        onClick={() => (canInstall ? void install() : setShowHint((v) => !v))}
        title="Install this app to open it offline on the trail"
      >
        ⬇ Install
      </button>
      {ios && showHint && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal text-gray-600 shadow-lg">
          Tap <span className="font-medium">Share</span>, then{' '}
          <span className="font-medium">Add to Home Screen</span> — it&rsquo;ll then open offline
          with no signal. If you opened this from a messaging app, tap its ⋯ menu →{' '}
          <span className="font-medium">Open in Safari</span> first.
        </div>
      )}
    </div>
  )
}

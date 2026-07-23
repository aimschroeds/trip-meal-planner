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
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal text-gray-600 shadow-lg">
          <p className="mb-1 font-medium text-gray-800">Install on iPhone</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Use <span className="font-medium">Safari</span> — if you came from Slack/Messages, tap
              that app&rsquo;s ⋯ → <span className="font-medium">Open in Safari</span> first.
            </li>
            <li>
              Tap <span className="font-medium">Safari&rsquo;s Share button</span> — the ⬆️
              box-with-an-arrow at the <span className="font-medium">bottom of Safari</span>, not a
              button on this page. If the toolbar is hidden, tap the address bar first to show it.
            </li>
            <li>
              Scroll down → <span className="font-medium">Add to Home Screen</span> →{' '}
              <span className="font-medium">Add</span>.
            </li>
          </ol>
          <p className="mt-1.5 text-gray-500">
            Open it from the new home-screen icon. First launch: connect to your shared plan on the{' '}
            <span className="font-medium">Backup</span> tab (paste your share link).
          </p>
        </div>
      )}
    </div>
  )
}

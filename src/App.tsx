import { useState } from 'react'
import { BackupPage } from './ui/BackupPage'
import { HelpPanel } from './ui/HelpPanel'
import { ItemsPage } from './ui/ItemsPage'
import { GearPage } from './ui/GearPage'
import { MealsPage } from './ui/MealsPage'
import { TripsPage } from './ui/TripsPage'
import { ReloadPrompt } from './ui/ReloadPrompt'
import { PwaInstallButton } from './ui/PwaInstallButton'
import { readJoinToken } from './sync/workspace'

const TABS = ['Trips', 'Food', 'Meals', 'Gear', 'Backup'] as const
type Tab = (typeof TABS)[number]

const HELP_DISMISSED = 'intro-dismissed'

function App() {
  // Opening a share link (…#join=<token>) lands on Backup, where the sync
  // panel offers to connect.
  const [tab, setTab] = useState<Tab>(() => (readJoinToken() ? 'Backup' : 'Trips'))
  // Which trip is open, lifted here so it survives switching to another top
  // tab and back (see the nav handler below for the "Trips" click behavior).
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  // Show the intro until dismissed once; re-openable via the Help button.
  const [showHelp, setShowHelp] = useState(() => localStorage.getItem(HELP_DISMISSED) === null)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-6">
          {/* Top row: title + actions. Title truncates so it never pushes the
              buttons off-screen on a phone. */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-base font-bold text-emerald-800 sm:text-lg">
              Hiking Trip Meal &amp; Gear Planner
            </h1>
            <div className="flex shrink-0 items-center gap-3">
              <PwaInstallButton />
              <button
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setShowHelp(true)}
              >
                Help
              </button>
            </div>
          </div>
          {/* Nav on its own row, horizontally scrollable so tabs never get cut. */}
          <nav className="-mb-px mt-2 flex gap-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  // Re-clicking "Trips" while already there backs out to the
                  // trip list; clicking it from elsewhere returns to whatever
                  // trip (and its setup/gear/etc. sub-tab) you had open — the
                  // one-click "back" to where you were.
                  if (t === 'Trips' && tab === 'Trips') setSelectedTripId(null)
                  setTab(t)
                }}
                className={`shrink-0 border-b-2 pb-1 ${
                  t === tab
                    ? 'border-emerald-700 font-medium text-emerald-800'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        {showHelp && (
          <HelpPanel
            onDismiss={() => {
              localStorage.setItem(HELP_DISMISSED, '1')
              setShowHelp(false)
            }}
          />
        )}
        {/* Every tab stays mounted (just hidden) once visited, so its
         *  in-progress state — a trip's setup/gear/etc. sub-tab, a form
         *  draft, a filter — is still there with one click back, instead of
         *  resetting on every switch away. */}
        <div hidden={tab !== 'Trips'}>
          <TripsPage selectedId={selectedTripId} onSelect={setSelectedTripId} />
        </div>
        <div hidden={tab !== 'Food'}>
          <ItemsPage />
        </div>
        <div hidden={tab !== 'Meals'}>
          <MealsPage />
        </div>
        <div hidden={tab !== 'Gear'}>
          <GearPage />
        </div>
        <div hidden={tab !== 'Backup'}>
          <BackupPage />
        </div>
      </main>
      <ReloadPrompt />
    </div>
  )
}

export default App

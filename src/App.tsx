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
  // Which trip is open, lifted here so clicking the "Trips" nav returns to the
  // trip list even from inside a trip's Setup/Days/Plan/Carries views.
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  // Show the intro until dismissed once; re-openable via the Help button.
  const [showHelp, setShowHelp] = useState(() => localStorage.getItem(HELP_DISMISSED) === null)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-8 px-6 py-4">
          <h1 className="text-lg font-bold text-emerald-800">Hiking Trip Meal &amp; Gear Planner</h1>
          <nav className="flex gap-4">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  // Clicking "Trips" always returns to the trip list.
                  if (t === 'Trips') setSelectedTripId(null)
                }}
                className={
                  t === tab
                    ? 'border-b-2 border-emerald-700 font-medium text-emerald-800'
                    : 'text-gray-500 hover:text-gray-800'
                }
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <PwaInstallButton />
            <button
              className="text-sm text-gray-500 hover:text-gray-800"
              onClick={() => setShowHelp(true)}
            >
              Help
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        {showHelp && (
          <HelpPanel
            onDismiss={() => {
              localStorage.setItem(HELP_DISMISSED, '1')
              setShowHelp(false)
            }}
          />
        )}
        {tab === 'Trips' && (
          <TripsPage selectedId={selectedTripId} onSelect={setSelectedTripId} />
        )}
        {tab === 'Food' && <ItemsPage />}
        {tab === 'Meals' && <MealsPage />}
        {tab === 'Gear' && <GearPage />}
        {tab === 'Backup' && <BackupPage />}
      </main>
      <ReloadPrompt />
    </div>
  )
}

export default App

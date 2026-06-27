import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { exportBackup, restoreBackup } from '../store/backup'
import {
  BACKUP_TABLES,
  parseBackup,
  serializeBackup,
  type BackupFile,
} from '../domain/backup'
import { downloadJson } from './download'
import { fileInputClass } from './styles'

const TABLE_LABELS: Record<(typeof BACKUP_TABLES)[number], string> = {
  trips: 'trips',
  people: 'people',
  items: 'items',
  meals: 'meals',
  resupplies: 'resupplies',
  planEntries: 'plan entries',
}

function summarize(counts: Record<(typeof BACKUP_TABLES)[number], number>): string {
  return BACKUP_TABLES.map((t) => `${counts[t]} ${TABLE_LABELS[t]}`).join(', ')
}

export function BackupPage() {
  const liveCounts = useLiveQuery(
    async () => ({
      trips: await db.trips.count(),
      people: await db.people.count(),
      items: await db.items.count(),
      meals: await db.meals.count(),
      resupplies: await db.resupplies.count(),
      planEntries: await db.planEntries.count(),
    }),
    [],
  )
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  async function exportToFile() {
    const data = await exportBackup()
    const date = new Date()
    downloadJson(
      `hiking-meal-planner-backup-${date.toISOString().slice(0, 10)}.json`,
      serializeBackup(data, date),
    )
  }

  function pickFile(file: File) {
    setRestored(false)
    void file.text().then((text) => {
      const result = parseBackup(text)
      if (result.ok) {
        setPending(result.backup)
        setError(null)
      } else {
        setPending(null)
        setError(`Cannot restore: ${result.error}`)
      }
    })
  }

  async function confirmRestore() {
    if (!pending) return
    try {
      await restoreBackup(pending.data)
      setPending(null)
      setRestored(true)
      setError(null)
    } catch (e) {
      setError(`Restore failed, existing data is unchanged: ${String(e)}`)
    }
  }

  const hasExistingData =
    liveCounts !== undefined && BACKUP_TABLES.some((t) => liveCounts[t] > 0)

  return (
    <div className="max-w-xl space-y-6">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-800">Export backup</h2>
        <p className="text-sm text-gray-600">
          All data lives only in this browser. Download a full backup —{' '}
          {liveCounts ? summarize(liveCounts) : '…'} — as a JSON file you can restore from
          later, on this or another device.
        </p>
        <button
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => void exportToFile()}
        >
          Download backup
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-800">Restore from backup</h2>
        <p className="text-sm text-gray-600">
          Restoring replaces <span className="font-medium">everything</span> currently in the
          app with the backup's contents.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          className={fileInputClass}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) pickFile(file)
            e.target.value = ''
          }}
        />
        {pending && (
          <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>
              Backup from{' '}
              <span className="font-medium">
                {new Date(pending.exportedAt).toLocaleString()}
              </span>{' '}
              containing {summarize(countTables(pending))}.
            </p>
            <p className="font-medium text-amber-900">
              {hasExistingData
                ? `This will permanently replace your current data (${
                    liveCounts ? summarize(liveCounts) : '…'
                  }).`
                : 'The app is currently empty — nothing will be overwritten.'}
            </p>
            <div className="flex gap-3">
              <button
                className="rounded bg-red-700 px-3 py-1 font-medium text-white"
                onClick={() => void confirmRestore()}
              >
                Replace everything &amp; restore
              </button>
              <button className="text-gray-500 underline" onClick={() => setPending(null)}>
                cancel
              </button>
            </div>
          </div>
        )}
        {restored && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
            Backup restored.
          </p>
        )}
        {error && (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}

function countTables(backup: BackupFile): Record<(typeof BACKUP_TABLES)[number], number> {
  return Object.fromEntries(
    BACKUP_TABLES.map((t) => [t, backup.data[t].length]),
  ) as Record<(typeof BACKUP_TABLES)[number], number>
}

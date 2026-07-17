import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { commitGearImport, type GearImportResult } from '../store/repos'
import { gearToCsv, parseGearCsv, type ParsedGearRow } from '../domain/csv/gear'
import { parseOwners } from '../domain/gear'
import type { CsvIssue } from '../domain/csv/items'
import type { GearItem } from '../domain/types'
import { downloadCsv } from './download'
import { fileInputClass } from './styles'

// Import gear from a CSV — tolerant of LighterPack's export as well as this
// app's own gear CSV. Export uses this app's format.
export function GearImportExport() {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const [parsed, setParsed] = useState<{ rows: ParsedGearRow[]; issues: CsvIssue[] } | null>(null)
  const [result, setResult] = useState<GearImportResult | null>(null)
  const [open, setOpen] = useState(false)
  const [importOwner, setImportOwner] = useState('')

  function pickFile(file: File) {
    setResult(null)
    void file.text().then((text) => setParsed(parseGearCsv(text)))
  }

  async function doImport() {
    if (!parsed) return
    // A LighterPack CSV has no owner column — apply the typed owner(s) to any
    // imported item that doesn't already name one (e.g. import Alice's pack).
    const owners = parseOwners(importOwner)
    const fields = parsed.rows.map((r) =>
      owners.length && !r.fields.owners?.length ? { ...r.fields, owners } : r.fields,
    )
    const res = await commitGearImport(fields)
    setParsed(null)
    setImportOwner('')
    setResult(res)
  }

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <button
        className="text-sm font-medium text-gray-700"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Import / export gear CSV
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Import a <span className="font-medium">LighterPack</span> CSV (export your list from
            lighterpack.com → “Export as CSV”) or this app’s own gear CSV. Names already in your
            library are skipped.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              className={fileInputClass}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) pickFile(file)
                e.target.value = ''
              }}
            />
            <button
              className="text-sm text-emerald-700 underline disabled:text-gray-400"
              disabled={gear.length === 0}
              onClick={() => downloadCsv('gear.csv', gearToCsv(gear))}
            >
              export gear CSV
            </button>
          </div>

          {parsed && (
            <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>
                {parsed.rows.length} gear item{parsed.rows.length === 1 ? '' : 's'} ready to import
                {parsed.issues.length > 0 && `, ${parsed.issues.length} row(s) skipped`}.
              </p>
              {parsed.issues.length > 0 && (
                <ul className="max-h-32 overflow-y-auto text-xs text-amber-900">
                  {parsed.issues.map((iss, i) => (
                    <li key={i}>
                      line {iss.line}: {iss.reason}
                    </li>
                  ))}
                </ul>
              )}
              <label className="flex flex-wrap items-center gap-2">
                Owner for these items (optional):
                <input
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  placeholder="e.g. Alice"
                  value={importOwner}
                  onChange={(e) => setImportOwner(e.target.value)}
                />
                <span className="text-xs text-gray-500">
                  applied to rows without an owner — a LighterPack export has none
                </span>
              </label>
              <div className="flex gap-3">
                <button
                  className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-50"
                  disabled={parsed.rows.length === 0}
                  onClick={() => void doImport()}
                >
                  Import {parsed.rows.length}
                </button>
                <button className="text-gray-500 underline" onClick={() => setParsed(null)}>
                  cancel
                </button>
              </div>
            </div>
          )}

          {result && (
            <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
              Added {result.added} item{result.added === 1 ? '' : 's'}
              {result.skipped > 0 && `, skipped ${result.skipped} already in your library`}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

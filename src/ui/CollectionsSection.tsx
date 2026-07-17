import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  createGearCollection,
  deleteGearCollection,
  renameGearCollection,
} from '../store/repos'
import type { GearCollection, GearItem } from '../domain/types'
import { fmtGrams } from './format'
import { CollectionEditorModal } from './CollectionEditorModal'

// Manage reusable gear collections ("Solo weekend", "Group rainy"). An item can
// be in several collections; a trip can apply a collection then add more.
export function CollectionsSection() {
  const collections = useLiveQuery(
    () => db.gearCollections.toArray(),
    [],
    [] as GearCollection[],
  )
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const gearById = new Map(gear.map((g) => [g.id, g]))
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [open, setOpen] = useState(false)

  function collectionWeight(c: GearCollection): number {
    return c.gearItemIds.reduce((n, id) => n + (gearById.get(id)?.weightG ?? 0), 0)
  }

  async function create() {
    const name = newName.trim()
    if (!name) return
    const id = await createGearCollection(name)
    setNewName('')
    setEditingId(id) // jump straight into picking items
  }

  const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <button className="text-sm font-medium text-gray-700" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Collections (reusable kits){collections.length ? ` · ${collections.length}` : ''}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Group gear into kits you reuse — e.g. “Solo weekend”, “Group rainy”. An item can be in
            several. On a trip, apply a collection from <span className="font-medium">Manage gear</span>,
            then add anything extra.
          </p>

          {sorted.length > 0 && (
            <ul className="space-y-1">
              {sorted.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                  {renamingId === c.id ? (
                    <>
                      <input
                        className="rounded border border-gray-300 px-2 py-0.5"
                        value={renameText}
                        autoFocus
                        onChange={(e) => setRenameText(e.target.value)}
                      />
                      <button
                        className="text-emerald-700 underline"
                        onClick={() => {
                          if (renameText.trim()) void renameGearCollection(c.id, renameText)
                          setRenamingId(null)
                        }}
                      >
                        save
                      </button>
                      <button className="text-gray-500 underline" onClick={() => setRenamingId(null)}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-gray-800">{c.name}</span>
                      <span className="text-gray-500 tabular-nums">
                        {c.gearItemIds.length} items · {fmtGrams(collectionWeight(c))}
                      </span>
                      <button
                        className="ml-auto text-emerald-700 underline"
                        onClick={() => setEditingId(c.id)}
                      >
                        edit items
                      </button>
                      <button
                        className="text-gray-600 underline"
                        onClick={() => {
                          setRenamingId(c.id)
                          setRenameText(c.name)
                        }}
                      >
                        rename
                      </button>
                      <button
                        className="text-red-700 underline"
                        onClick={() => void deleteGearCollection(c.id)}
                      >
                        delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="new collection name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
            <button
              className="rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              disabled={newName.trim() === ''}
              onClick={() => void create()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {editingId && (
        <CollectionEditorModal collectionId={editingId} onClose={() => setEditingId(null)} />
      )}
    </section>
  )
}

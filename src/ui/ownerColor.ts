// Stable per-owner colours so each person is visually distinct (and a
// multi-owner item reads as several people). The colour is a hash of the
// lower-cased name, so the same person is the same colour everywhere.

// Full class strings (not built dynamically) so Tailwind keeps them in the build.
const OWNER_COLORS = [
  'bg-rose-100 text-rose-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-lime-100 text-lime-800',
  'bg-orange-100 text-orange-800',
] as const

/** Stable colour classes for an owner name (case-insensitive). */
export function ownerColorClass(name: string): string {
  const key = name.trim().toLowerCase()
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return OWNER_COLORS[h % OWNER_COLORS.length]
}

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

// Solid (filled) variants, same order/hue as OWNER_COLORS — for a selected
// toggle chip (e.g. a "carried by" person), so the same person reads as the
// same colour whether shown as a pill or a highlighted button.
const OWNER_BUTTON_COLORS = [
  'border-rose-600 bg-rose-600 text-white',
  'border-amber-600 bg-amber-600 text-white',
  'border-emerald-600 bg-emerald-600 text-white',
  'border-sky-600 bg-sky-600 text-white',
  'border-violet-600 bg-violet-600 text-white',
  'border-fuchsia-600 bg-fuchsia-600 text-white',
  'border-teal-600 bg-teal-600 text-white',
  'border-indigo-600 bg-indigo-600 text-white',
  'border-lime-600 bg-lime-600 text-white',
  'border-orange-600 bg-orange-600 text-white',
] as const

/** Stable palette index for an owner name (case-insensitive). */
function ownerIndex(name: string, mod: number): number {
  const key = name.trim().toLowerCase()
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % mod
}

/** Stable colour classes for an owner name (case-insensitive), pill style. */
export function ownerColorClass(name: string): string {
  return OWNER_COLORS[ownerIndex(name, OWNER_COLORS.length)]
}

/** Solid button classes (border + bg + white text) for a selected owner chip,
 *  in the same hue as {@link ownerColorClass}. */
export function ownerButtonClass(name: string): string {
  return OWNER_BUTTON_COLORS[ownerIndex(name, OWNER_BUTTON_COLORS.length)]
}

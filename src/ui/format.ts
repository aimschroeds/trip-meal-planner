import type { ResupplyTiming, Slot } from '../domain/types'

export const fmtDensity = (calPerGram: number) => `${calPerGram.toFixed(2)} cal/g`
export const fmtGrams = (g: number) => `${Math.round(g)} g`
export const fmtCalories = (cal: number) => `${Math.round(cal)} cal`

export const fmtSlot = (slot: Slot) =>
  slot.type === 'snack' ? `snack (${slot.timing})` : slot.type

/** Resupply timings in chronological order, with their display labels —
 *  shared by Setup (the picker) and the Plan view (the day reminder). */
export const RESUPPLY_TIMINGS: { value: ResupplyTiming; label: string }[] = [
  { value: 'before_breakfast', label: 'before brekkie' },
  { value: 'after_breakfast', label: 'after brekkie' },
  { value: 'before_lunch', label: 'before lunch' },
  { value: 'after_lunch', label: 'after lunch' },
  { value: 'late_afternoon', label: 'late afternoon (before dinner)' },
  { value: 'after_dinner', label: 'after dinner' },
]

export const resupplyTimingLabel = (t: ResupplyTiming) =>
  RESUPPLY_TIMINGS.find((rt) => rt.value === t)?.label ?? t

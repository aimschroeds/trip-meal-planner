// Trip calendar dates from an optional start date. Pure — no formatting
// (the UI formats). Day and resupply indices are 1-based within the trip.

/** Local calendar date of day N (1-based) for a trip start ("yyyy-mm-dd"), or
 *  null when there's no valid start date. Parsed as a LOCAL date (not UTC) so
 *  it doesn't drift a day across time zones. */
export function tripDayDate(startDate: string | undefined, dayIndex: number): Date | null {
  if (!startDate) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim())
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + (dayIndex - 1))
  return date
}

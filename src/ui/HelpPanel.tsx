import { useState } from 'react'

/** First-run "how it works" + a small glossary. Shown expanded until
 *  dismissed (remembered in localStorage); re-openable from the header. */
export function HelpPanel({ onDismiss }: { onDismiss: () => void }) {
  const [showGlossary, setShowGlossary] = useState(false)

  const steps = [
    ['Food', 'Build your food library — type an item, import a CSV, snap a photo of a label, or describe a meal in words.'],
    ['Meals', 'Combine foods into reusable meals (e.g. a standard breakfast). Optional — you can drop loose foods straight into a day.'],
    ['Gear', 'Catalog your kit with weights split into base / worn / consumable, and a category (shelter, sleep, pack = the “big 3”). Import a LighterPack CSV to fill it fast.'],
    ['Trips', 'Create a trip, add who’s coming and each person’s daily calorie target, and mark resupplies — the app splits the route into “carries”.'],
    ['Plan', 'For each day, assign meals or foods (or tap ✨ generate) and check calories vs. target.'],
    ['Carries', 'The pack view: per-carry shopping & packing lists, assign who carries which gear, and the full food + gear pack-weight breakdown (base weight, worn, per-carry, heaviest).'],
    ['Sync & offline', 'On the Backup tab: publish to sync live with hiking partners, and install the app to use it offline on the trail.'],
  ]

  const glossary = [
    ['Carry', 'The stretch between two resupplies — i.e. one batch of food you carry at once.'],
    ['Base weight', 'Gear (and food packaging) that isn’t eaten or worn — the number most hikers optimize.'],
    ['Worn', 'Weight carried on your body (shoes, hiking shirt), not counted in pack weight.'],
    ['Consumable', 'Weight that depletes on trail — food, fuel, water.'],
    ['Off-trail', 'A meal eaten in town/at a lodge — counts toward the day’s calories but adds no pack weight.'],
    ['Generate', 'Auto-fills a day’s empty slots from your library to hit the calorie target; locked picks are kept.'],
  ]

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
      <div className="flex items-start gap-3">
        <h2 className="font-semibold text-emerald-900">How it works</h2>
        <button
          className="ml-auto text-xs text-emerald-800 underline"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          dismiss
        </button>
      </div>
      <ol className="mt-2 space-y-1 text-gray-700">
        {steps.map(([name, desc], i) => (
          <li key={name}>
            <span className="font-medium text-emerald-900">
              {i + 1}. {name}
            </span>{' '}
            — {desc}
          </li>
        ))}
      </ol>
      <button
        className="mt-3 text-xs font-medium text-emerald-800 underline"
        onClick={() => setShowGlossary((v) => !v)}
      >
        {showGlossary ? 'hide' : 'what the words mean'}
      </button>
      {showGlossary && (
        <dl className="mt-2 space-y-1 text-gray-700">
          {glossary.map(([term, desc]) => (
            <div key={term}>
              <dt className="inline font-medium text-emerald-900">{term}:</dt>{' '}
              <dd className="inline">{desc}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

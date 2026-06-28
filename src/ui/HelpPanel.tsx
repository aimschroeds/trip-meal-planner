import { useState } from 'react'

/** First-run "how it works" + a small glossary. Shown expanded until
 *  dismissed (remembered in localStorage); re-openable from the header. */
export function HelpPanel({ onDismiss }: { onDismiss: () => void }) {
  const [showGlossary, setShowGlossary] = useState(false)

  const steps = [
    ['Items', 'Build your food library — type an item, import a CSV, snap a photo of a label, or describe a meal in words.'],
    ['Meals', 'Combine items into reusable meals (e.g. a standard breakfast). Or skip this — you can drop loose items straight into a day.'],
    ['Trips', 'Create a trip, then add who’s coming and each person’s daily calorie target.'],
    ['Resupplies', 'On a trip, mark where you restock. The app splits the route into “carries” — what you pack between resupplies.'],
    ['Plan', 'For each day, assign meals or items (or tap ✨ generate). Check calories vs. target, pack weight, and the per-carry shopping list.'],
  ]

  const glossary = [
    ['Carry', 'The stretch between two resupplies — i.e. one batch of food you carry at once.'],
    ['Day type / effort', 'Small / average / big / huge scales a day’s calorie target. Upload an itinerary (distance + ascent) to set it automatically.'],
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

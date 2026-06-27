# Hiking Trip Meal Planner — User Stories

> **Living spec.** Epics 1–8 are the original PRD the app was built against;
> PLAN.md cites their story numbers (e.g. "story 3.2", "4.1") and every
> acceptance criterion maps to a unit test in `tests/`. **Epics 9–12** capture
> capabilities added since, written as built. PLAN.md (§5 milestones, §6
> resolutions, §9 backlog) tracks the engineering behind it all.

**Persona:** The *Trip Planner* — a hiker organizing food for themselves and others on a multi-day trip. (All stories assume this persona unless noted.)

-----

## Epic 1: Trip & People Setup

**1.1** As a trip planner, I want to create a trip with a name and a number of days (or start/end dates), so that I have a container for all planning.

**1.2** As a trip planner, I want to add one or more people to a trip, each with their own baseline daily calorie target, so that food quantities reflect individual needs.

**1.3** As a trip planner, I want to mark each person as vegetarian or not, so that meal selection and generation respect dietary constraints.

-----

## Epic 2: Days & Effort Scaling

**2.1** As a trip planner, I want to classify each day as **small / average / big / huge**, so that calorie needs scale with effort.

**2.2** As a trip planner, I want configurable scaling factors per day type (defaults e.g. small 0.75×, avg 1.0×, big 1.25×, huge 1.5×), so that I can tune them to my group.

*Acceptance criteria:* A person’s target for a day = baseline target × day-type factor.

**2.3** As a trip planner, I want to mark the first and/or last day as partial by specifying which meal slots apply (e.g., last day = brekkie + snacks only, off trail by lunch), so that I don’t carry food I won’t eat.

-----

## Epic 3: Resupplies & Carries

**3.1** As a trip planner, I want to define resupply points by day and timing (before breakfast / after lunch / late afternoon, etc.), so that the app knows when food gets replenished.

**3.2** As a trip planner, I want the app to automatically derive carries from resupply points, so that every meal slot belongs to exactly one carry.

*Acceptance criteria (10-day trip, resupplies day 3 before brekkie, day 6 after lunch, day 8 late afternoon):*

- Carry 1: day 1 start → day 2 dinner
- Carry 2: day 3 brekkie → day 6 lunch
- Carry 3: day 6 dinner → day 8 lunch/afternoon snacks
- Carry 4: day 8 dinner → trip end

**3.3** As a trip planner, I want to see which days and meal slots fall into each carry, so that I can sanity-check the boundaries before packing.

-----

## Epic 4: Food Items & Meal Library

**4.1** As a trip planner, I want to add food items (e.g., oatmeal, chia seeds, butter, a Snickers bar) with name, weight, calories, and vegetarian (true/false), so that I have atomic building blocks for meals.

*Acceptance criteria:* Weight/calories may be entered per gram, per 100g, per serving, or per package; the app normalizes everything to calorie density (cal/g).

**4.2** As a trip planner, I want the app to compute and display calorie density for every item, so that I can compare efficiency at a glance.

**4.3** As a trip planner, I want to compose a **meal** from one or more items, each with a quantity (e.g., brekkie = 80g oatmeal + 15g chia + 20g butter), so that meals reflect what I actually eat.

*Acceptance criteria:*

- Meal weight = Σ item quantities; meal calories = Σ (quantity × item density); meal density derived from those
- Meal is vegetarian only if **every** item in it is vegetarian
- A single item can be used directly as a meal (e.g., a freeze-dried dinner)

**4.4** As a trip planner, I want to assign the meal type (brekkie / snack / lunch / dinner) at the **meal** level, so that type-agnostic items like butter can appear in meals of any type.

**4.5** As a trip planner, I want to save composed meals to the library as reusable recipes, so that I don’t rebuild “standard oatmeal brekkie” for every day.

**4.6** As a trip planner, I want to edit and delete items and meals, so that the library stays current.

*Acceptance criteria:* Editing an item’s weight/calories updates every meal containing it. Deleting an item used by meals or plans prompts a warning (block vs. cascade — TBD).

**4.7** As a trip planner, I want to filter and sort meals by type, vegetarian flag, and calorie density (and items by density/vegetarian), so that I can quickly find suitable options.

**4.8** As a trip planner, I want to bulk import **items** from a CSV, so that I can seed the library without manual entry.

*Acceptance criteria:*

- Columns: `name, weight_g, calories, vegetarian` (weight/calories on any consistent basis — per serving, per 100g — normalized to density on import)
- Import shows a validation preview before committing; bad rows are reported with line number and reason (missing field, non-numeric, etc.) without blocking valid rows
- Duplicate names (vs. library or within the file): user chooses skip / update existing / import as copy

**4.9** As a trip planner, I want to bulk import **meals** from a CSV that references items by name, so that recipes can be set up in bulk too.

*Acceptance criteria:*

- One row per meal–item pair: `meal_name, meal_type, item_name, quantity_g`; rows sharing a `meal_name` form one meal
- Item names that don’t exist in the library are flagged; user chooses to fail those rows or auto-create stub items to fill in later
- Weight, calories, density, and vegetarian are **computed** from items, never imported — keeps roll-up logic as the single source of truth

**4.10** As a trip planner, I want to export items and meals to CSV, so that the library is portable — for backup, editing in a spreadsheet, or sharing with trip partners.

*Acceptance criteria:*

- Exports use the exact same column formats as 4.8 (items) and 4.9 (meals), so an export can be re-imported without modification (lossless round-trip)
- Export scope is selectable: full library, or only items/meals used in a given trip
- Exporting meals also offers to export the referenced items, so a shared meals file doesn’t arrive with dangling item references

-----

## Epic 5: Daily Meal Planning (Manual)

**5.1** As a trip planner, I want to assign library meals to each day’s slots (one brekkie, one lunch, one dinner, any number of snacks), so that I can build a plan by hand.

**5.2** As a trip planner, I want to assign the same item multiple times (e.g., two snack bars), so that quantities are flexible.

**5.3** As a trip planner, I want to plan per person, so that different calorie targets and diets are respected.

*Decision:* Each person gets their own fully individual plan; shared group meals (one dinner split N ways) are out of scope.

-----

## Epic 6: Off-Trail Meals

**6.1** As a trip planner, I want to mark any meal slot as **off-trail** (restaurant / lodge / town), so that it’s excluded from carry weight.

**6.2** As a trip planner, I want off-trail meals to count toward the day’s calorie picture but contribute **zero weight** to any carry, so that totals stay honest.

*Decision:* Off-trail meals require no library entry and have zero weight. A calorie estimate is **optional**; when provided, it counts toward the day’s calorie total, and when omitted the day is shown as partially estimated rather than under target.

-----

## Epic 7: Calculations & Summaries

**7.1** As a trip planner, I want per-day totals (per person): total calories, total weight, calories vs. target (absolute and %), so that I can spot under/over-fueled days.

**7.2** As a trip planner, I want per-carry totals (per person and group): total weight, total calories, and average calorie density, so that I know what’s on each back between resupplies.

**7.3** As a trip planner, I want trip-level totals and a carry-by-carry breakdown, so that I can review the whole plan at once.

**7.4** As a trip planner, I want days/slots that miss their calorie target beyond a tolerance to be visually flagged, so that gaps are obvious.

-----

## Epic 8: Plan Generation

**8.1** As a trip planner, I want the app to auto-generate a meal plan for a day (or whole carry) given: the person’s scaled calorie target, day type, the carry’s calorie-density target, and vegetarian constraint, so that I get a good starting plan fast.

*Acceptance criteria:*

- Fills one brekkie, one lunch, one dinner, plus snacks to close the calorie gap
- Hits the day’s calorie target within a tolerance (e.g., ±5%)
- Prefers higher-density items when the carry has a density target, minimizing weight
- May scale item quantities within a meal (within configurable min/max bounds) to fine-tune the calorie total — e.g., adding butter to oatmeal to close a gap densely
- Only selects vegetarian items for vegetarian people
- Skips slots marked off-trail and respects partial first/last days

**8.2** As a trip planner, I want to lock specific manual picks before generating, so that generation fills around my choices rather than replacing them.

**8.3** As a trip planner, I want to regenerate with one tap and tweak the result manually, so that generation is a starting point, not a cage.

-----

# Post-PRD Epics (as built)

Epics 1–8 above are the original spec. Epics 9–12 capture capabilities added
after it, written as built and shipped. PLAN.md §9 tracks the engineering
backlog behind them.

-----

## Epic 9: Resupply Timing & Location

Extends Epic 3.

**9.1** As a trip planner, I want to place a resupply at any meal boundary in the day — before brekkie, after brekkie, before lunch, after lunch, late afternoon (before dinner), or after dinner — so that a resupply lands exactly where it really happens.

*Acceptance criteria:*

- The six timings correspond to the six boundaries between a day’s slot groups (brekkie → morning snacks → lunch → afternoon snacks → dinner → evening snacks)
- A resupply’s timing is the cut point: slots before it stay in the old carry, slots at/after it start the new carry, including splitting that day’s snacks

**9.2** As a trip planner, I want to name each resupply by location (e.g., “Vizzavona”), so that carries are labelled by place — how hikers actually refer to them.

*Acceptance criteria:*

- Each carry shows where it begins and ends by resupply location; the open ends read as trip “start” / “finish”
- A carry ends at the *next* carry’s resupply location
- Location is optional; when a resupply has no location, its carry endpoints read as unnamed rather than inventing a label

-----

## Epic 10: Data Backup & Restore

Complements the CSV portability of 4.8–4.10 with a full-database safety net — local-first means the browser profile *is* the database.

**10.1** As a trip planner, I want to export my entire database (trips, people, items, meals, resupplies, plans) to a single JSON file, so that I have a complete backup independent of the browser.

*Acceptance criteria:* One file captures every table in a versioned envelope; it is not the same as the per-library CSV export (4.10), which covers only items and meals.

**10.2** As a trip planner, I want to restore from a backup file — replacing current data, with a confirmation step first — so that I can move between devices or browsers without losing or silently clobbering data.

*Acceptance criteria:*

- Restore previews the file’s contents and what it will overwrite, and requires explicit confirmation before replacing anything
- Invalid or foreign files are rejected with a reason; a partial/failed restore leaves existing data untouched
- **Security:** a backup never contains the photo-extraction API key (Epic 11). The key is held in `localStorage`, never in the Dexie database, precisely so that a JSON backup — which a user may email, share, or sync — can never leak the credential

-----

## Epic 11: Add Items by Photo

**11.1** As a trip planner, I want to add a library item by photographing a product’s packaging (front of pack and/or the nutrition label), so that I can capture items without typing.

*Acceptance criteria:*

- 1–2 photos, with direct phone-camera capture
- Extracts name, net weight, calories per package, and vegetarian/vegan markings, and prefills the Add Item form on a per-package basis for review
- Extraction is a draft — it never saves an item silently; the planner edits and confirms

**11.2** As a trip planner, I want photo extraction to use my own AI provider key that stays on my device, so that the app remains local-first and private.

*Acceptance criteria:*

- Opt-in; the feature is absent until a key is configured
- The key is stored locally and is never included in a backup (Epic 10)
- Photos are sent only to the AI provider, directly from the browser; there is no app server in the path

-----

## Epic 12: Units, Pieces & Shopping Lists

**12.1** As a trip planner, I want to give an item a piece weight and name (e.g., one tortilla = 64 g), so that I can think and compose in pieces while the app keeps grams as the source of truth.

*Acceptance criteria:*

- Meal components can be entered in pieces or grams interchangeably; grams remain the canonical, stored quantity
- Piece weight/name round-trip through the items CSV (4.8/4.10) as optional columns

**12.2** As a trip planner, I want a per-carry shopping list, so that I know how much of each item to buy for each leg of the trip.

*Acceptance criteria:*

- Totals each item’s grams across all people on the carry, including any generation quantity-scaling
- Shows piece counts for items with a piece weight, and whole packages to buy for items entered per package

-----

## Epic 13: Flexible Slot Composition

Generalises Epic 5: a day's meal slot is no longer one library meal but an
ordered **list of parts**, where each part is either a library meal or a loose
item with a gram quantity. Matches how real plans are written — a breakfast of
oatmeal + dried blueberries + butter, a dinner of a main plus hot chocolate, a
snack that's just a bar — without forcing every combination into a saved meal.

**13.1** As a trip planner, I want to put several things in one slot — any mix of library meals and loose items — so that I can plan "dinner + dessert" or a multi-item snack without pre-composing a named meal for it.

*Acceptance criteria:*

- A slot holds an ordered list of parts; each part is a meal (with optional generation scale) or an item (with grams)
- The slot's weight and calories are the sum of its parts; the per-day and per-carry totals and the shopping list all aggregate parts
- A loose item defaults to its serving when added (Epic 9.7 / units), and its grams stay editable
- Off-trail remains a whole-slot state (zero weight, optional estimate) and is offered only on an empty slot
- Locking a slot preserves all its parts through generation; generation still fills empty unlocked slots with a single meal part
- Deleting an item or meal is blocked while it's used directly in any plan slot, not only via a meal (extends 4.6)

**13.2** As a trip planner restoring an older backup, I want my previous one-meal-per-slot plans to load unchanged, so that upgrading never loses a plan.

*Acceptance criteria:* A pre-Epic-13 plan entry (a single meal per slot) is migrated to a one-part slot automatically — both by the Dexie schema upgrade and when restoring a legacy JSON backup.

-----

## Epic 14: Copy a Day Across the Trip

The reason to leave the spreadsheet: multi-day trips repeat the same
breakfast / lunch / snacks every day, and re-entering them by hand is the
pain. Build one representative day, replicate it, then vary the dinners.

**14.1** As a trip planner, I want to copy one day's plan onto other days I choose, so that I don't re-enter the same meals for every day of the trip.

*Acceptance criteria:*

- Copy is per person (plans are individual) and targets a chosen set of other days
- Only slots that exist on both the source and a target day are copied, so partial first/last days neither lose nor gain slots
- Locked target slots are left untouched; copying onto a slot that already has food asks for confirmation first
- The copy is independent — later editing the source day doesn't change the copies

-----

## Epic 15: Itinerary-Driven Day Sizing

Refines Epic 2: instead of hand-picking each day's effort, derive it from the
route. Upload (or type) each day's distance and ascent, and the day's
small/average/big/huge type — and therefore its calorie target — follows.

**15.1** As a trip planner, I want to give each day a leg name and its planned distance and ascent, so that my plan reflects the actual route and days read as "Day 3 — Vizzavona → Petra Piana".

*Acceptance criteria:*

- Each day optionally carries a name, distance (km), and ascent (m); all can be uploaded from a CSV (`day, distance_km, ascent_m`, optional `name`) or typed inline
- Bad CSV rows are reported with line and reason without blocking good rows; rows for days outside the trip are reported as unmatched

**15.2** As a trip planner, I want the day's size to be derived from distance and climb, so that calorie targets scale with how hard the day actually is.

*Acceptance criteria:*

- Effort = distance + ascent ÷ 100 m (100 m of climb ≈ 1 km flat; the weighting is a documented default)
- Effort maps to the day type (small < 12, average < 20, big < 28, huge ≥ 28 effort km), which scales the target via the existing day-type factors
- The derived type can still be overridden by hand; re-uploading or editing distance/ascent re-derives it

-----

## Resolved Decisions

From the original PRD:

1. **Fully individual plans per person** — no shared/communal meals (5.3).
1. **Partial first/last days are modeled by selecting which meal slots apply** — no fractional multiplier (2.3).
1. **Off-trail meals have zero weight with an optional calorie estimate** (6.2).

The PRD’s three open items, since resolved (PLAN.md §6):

4. **Snack timing on resupply days** — each slot carries a coarse timing and a resupply’s timing is a cut position within the day (§6.1; `src/domain/carries.ts`).
4. **Deleting an in-use item or meal** — **blocked** with the list of dependents reported, not cascaded (§6.2; `src/store/repos.ts`).
4. **Quantity-scaling bounds for generation** — optional per-item `minGrams`/`maxGrams` clamp generation scaling on top of the global 0.5–1.5× bound (§6.3; `src/domain/generate.ts`, `rollups.ts`).

## Open Items

None at this time.

-----

## Engineering notes (not user stories)

Shipped infrastructure that doesn’t map to a planner-facing story: a Playwright
end-to-end smoke test wired into CI, and automatic deployment to GitHub Pages on
every merge to `main` (https://aimschroeds.github.io/trip-meal-planner/).

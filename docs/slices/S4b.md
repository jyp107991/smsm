# S4b: places, current country, trips, other currencies

Brief per `docs/ENGINEERING.md` §5.1; the second half of S4 (S4a chapters is `S4.md`). Process: money (other currency), saving and syncing take the full protocol; screens and wording the lighter one.

## Goal
Spending abroad is as easy as at home: each phone knows which country it's in (by hand, or from location if allowed), new entries carry that country and the town, a foreign amount is typed in its own currency with the day's rate filled in, the phone offers to start a trip when it lands somewhere new and to close it when home again, and Activity can be filtered by country and place.

## Criteria in scope
PLC-1, PLC-2, PLC-3, PLC-4, PLC-5 (already enforced: recurring posts at home), PLC-6, PLC-7 (Activity filters; Insights totals are S5), CHP-6, OFF-4 (place names and the day's rate need a connection: the current country and the last rate are used, both editable).

## Out of scope
Insights by country (S5). Receipts in another currency (S6 feeds the same form). Maps.

## Services (checked 17 Nov 2026; recorded in DECISIONS)
- **Place names:** BigDataCloud free client reverse geocoding, `GET https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=..&longitude=..&localityLanguage=en`, keyless, CORS `*`, must be called from the device with its own current position (never stored or third-party coordinates; never server-side). Fields used: `countryCode`, `city` (else `locality`).
- **Rates:** Frankfurter, `GET https://api.frankfurter.dev/v2/rate/{from}/gbp` (optionally `?date=YYYY-MM-DD`) → `{ date, base, quote, rate }`, keyless, CORS `*`, reference rates published daily; caching encouraged. The phone keeps the last rate per currency (localStorage `smsm-rates`) and uses it offline.
- No new packages. Both calls go through `src/data` (the only I/O layer), behind a small interface so tests use fakes.

## Decisions made here (recorded in DECISIONS)
- **Current country is per phone** (localStorage `smsm-current-country`; default the household's home country). Set by hand in Settings → "Where you are" (a list of countries), by the trip suggestion, or by "Welcome home". New manual entries take it; editing never changes an entry's country unless the person does.
- **Location is off until asked.** Settings → "Where you are" has "Use location" (a switch). The first time it's turned on, the browser asks; the reason is shown first ("So new entries get the town, and smsm can notice a trip"). The app never asks on its own and works fully without it. Positions are rounded to 3 decimal places (about 100 m) before they leave the phone or are stored.
- **Capture:** with location on, an entry dated today gets the phone's position, country and town when the Add sheet opens (and quick add when saved), if they arrive within 4 s; otherwise it is saved with the current country and no place (never blocks saving, non-negotiable 5). The place shows as a chip ("Kyoto") in the Add sheet with "Remove place"; More details has a "Place" text box to type or change it. A typed place stores no position.
- **Trip suggestion (PLC-4):** checked when the app opens and when it comes back to the front, only if location is on (permission already granted; never prompts). Abroad (country ≠ home) with no open trip chapter for that country: Home shows "Looks like you're in Japan. Start a trip?" — Yes creates an open trip chapter (name = the country's name, emoji 🧳, country, start today), makes it current and sets the current country; No hides it for that country until the phone has been home again. Home again with an open trip that is current on this phone: "Welcome home. Close Japan? 9 days, £1,840.00." — Close closes it (S4a) and sets the current country home; "Not yet" hides it for the day.
- **Other currency (PLC-6):** when the entry's country uses another currency (a fixed country → currency table in the core), the Add sheet offers "Paid in JPY" under the amount. Turned on, the amount field takes JPY and a "Rate" field shows "1 JPY = £0.0047475" filled from the day's rate (editable); the pounds figure is worked out live: `amount_pence = round(original × rate × 100)`, halves up, exactly (decimal strings, never floats), stored once with `original_amount`, `original_currency`, `fx_rate` for reference. Card payments already in pounds: leave it off. Editing the pounds amount of such an entry later clears the original fields (they no longer describe it).
- **Filters (PLC-7, CHP-6):** Activity gets "Country" and "Place" filters (the countries and places that occur in the household's entries).

## Screens
Settings → "Where you are" (current country list, Use location switch); Add sheet (place chip, Place text box in More details, Paid in ⟨currency⟩ with Rate); Home (trip suggestion, welcome home); entry page (country if not home, place, "¥1,200 at 1 JPY = £0.0047475"); Activity filters.

## Data / core
- Core `src/core/fx.ts`: `currencyOf(country)`, `foreignToPence(originalText, rateText)` → Pence | null (decimal-exact, halves up), `formatForeign(amount, currency)`. Core `roundPosition(n)` (3 dp).
- Data: `useCurrentCountry()`, `setCurrentCountry(code)`; `useLocationSetting()`, `setUseLocation(on)`; `locate()` → `{ lat, lng, country, place } | null` (geolocation + BigDataCloud, 4 s timeout, rounded); `rateFor(currency, date?)` → `{ rate, date, stale }` (Frankfurter, cached per currency, offline last known); `ExpenseDraft` gains `country`, `place`, `lat`, `lng`, `original: { amount: string; currency: string; rate: string } | null`.
- Writes already carry these columns (`EXPENSE_WRITE_COLUMNS`); check and extend.

## Tests
Core: currency table, fx vectors and properties (exact decimals, rounding), position rounding. Data: current country and location setting per phone; capture with fake services (success, slow, offline, denied); rates cached and used offline; drafts carry country/place/original. Screens: Settings, Add sheet place and currency, Home suggestions, entry page, filters. E2E: the new screens at 320/390, both themes, axe.

## Interfaces (what the tests are written against)
- Settings: section heading "Where you are"; combobox "Current country" (English names, e.g. "Japan"; default "United Kingdom"); switch or checkbox "Use location" with the reason as its description.
- Add sheet: when an entry has a place, a button "Kyoto" in group "Place" plus button "Remove place"; More details textbox "Place". When the country uses another currency: switch or checkbox "Paid in JPY"; when on, textbox "Amount" takes the foreign amount, textbox "Rate" holds the rate (GBP per unit, e.g. "0.0047475"), and the summary line reads "¥1,200 = £5.70" (formatting per currency, en-GB).
- Home: text "Looks like you're in Japan. Start a trip?" with buttons "Start a trip" and "No"; text "Welcome home. Close Japan? 9 days, £1,840.00." with buttons "Close Japan" and "Not yet".
- Entry page: "Country" detail when not home; "Place" detail; "Paid ¥1,200 at 1 JPY = £0.0047475".
- Activity: filter buttons "Country" and "Place".
- Data: `setCurrentCountry`, `useCurrentCountry`, `setUseLocation`, `useLocationSetting`, `locate`, `rateFor`; services injectable through the data layer options (`geo`, `rates`) so tests pass fakes; `ExpenseDraft.country/place/lat/lng/original`.
- Core: `currencyOf`, `foreignToPence`, `formatForeign`, `roundPosition`.

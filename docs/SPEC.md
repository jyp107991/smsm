# smsm: product spec (v2)

## 1. What smsm is

smsm is a phone app for two people who share a home. It records money either of them spends on shared things and keeps one running answer to "who owes whom". It is built for exactly two people and for pounds, and that narrowness is the advantage: everything a group app spends its complexity on (who is in which group, simplifying debts between many people, many currencies) disappears, and the space goes to things a couple wants.

**Scope rule.** smsm tracks shared spending and the debt between the two people. It holds nothing about either person's own finances: no incomes, no personal spending, no budgets, no savings goals. If a feature needs individual finances to make sense, it is out of scope.

**Three rules for every feature**
1. *Code computes, people decide.* Every figure is calculated by tested code from recorded entries. AI may read, suggest and phrase; it never calculates, and nothing it produces becomes money without a person's tap.
2. *Nothing blocks adding.* Saving an expense is instant, offline or online, with or without AI.
3. *One number.* However rich the app gets, the answer to "are we square?" stays one sentence on the first screen.

Each feature below has short, numbered acceptance criteria (`ADD-3`, `SET-2`…). They are the contract: every one has a test named after it, or is explicitly deferred in `docs/OPEN_ITEMS.md` (`docs/ENGINEERING.md` §2).

## 2. Where this beats the existing apps

| | Splitwise (Pro) | Tricount | smsm |
|---|---|---|---|
| Unlimited entries, no ads | paid | yes | yes |
| Receipt scanning and itemising | paid | no | yes, and it itemises so you can untick lines that are just yours |
| Search, charts, default splits | paid | limited | yes |
| Recurring | fixed only | no | fixed, variable ("how much was the energy bill?"), auto-detected, subscription audit |
| Trips and one-offs | separate groups, separate balances | separate tricounts | chapters: separate totals, one balance, kept out of your "usual month" |
| Location | no | no | country and place on every entry; trips suggest themselves |
| Paying each other | Venmo/PayPal (US) | bunq | one tap opens Monzo with the amount filled in |
| Refunds | awkward | awkward | "money back" entries |
| Monthly summary | email of totals | no | a five-line recap, written for the two of you |
| Ask in plain English | no | no | "how much did we spend on food in Japan?" |
| Both people's edits | history | no | history, undo, comments, and approvals for the things that should need two |
| Works offline, yours to keep | partly | partly | fully; your data in your own database, exportable |

## 3. Features: the daily loop

### 3.1 Home and the balance [BAL]
The first screen answers "are we square?" and lets you add.
- BAL-1 The balance is one signed number: each person's net is what they paid minus their share of every live entry, adjusted by settle-ups (`docs/DATA_MODEL.md` §3). The two nets always sum to zero.
- BAL-2 Shown as a sentence with both avatars: "All square", or "Sam owes Jae £24.50". Names, never "you owe" (the same sentence on both phones).
- BAL-3 The plank the two animals sit on tilts with the balance (DESIGN §4.1): level when square.
- BAL-4 **Whose turn.** When the balance is £10 or more, a quiet line says "Next one's on Sam". Paying when it's your turn is the easiest way to stay square.
- BAL-5 Offline, the balance is computed from the phone's copy and marked "offline".
- BAL-6 Before the partner joins: "Waiting for your partner" with a share-invite button; adding still works.

### 3.2 Adding [ADD]
- ADD-1 **Quick add.** One box on Home. `42.50 tesco` and Enter saves. Grammar (any order after the amount): amount (required: `42.5`, `£42.50`, `1,200`, simple sums `12+8.50`); category word or prefix (`groc`); payer (`me`, a name, `cat`/`dog`); split (`60/40`, `treat`, `for sam`); date (`yesterday`, `mon`, `12/11`); `#tag`; the remaining words are the description.
- ADD-2 A live reading appears under the box as you type ("£42.50 · Tesco · Groceries · Jae paid · 50/50"); tapping it opens the full form prefilled.
- ADD-3 Anything not typed is filled from what the household has taught the app: category and usual split for that description (3.6), payer = me, date = today, chapter and country = the current ones (4.2, 4.3).
- ADD-4 **Full form** (a bottom sheet): amount, description (autocomplete from history), category, who paid, split, date; under "More": chapter, place, notes, tags, photo, itemise, paid in another currency, repeat.
- ADD-5 The amount field accepts sums (`18.50+4+12`) and shows the result.
- ADD-6 Save is instant and works offline; a toast offers Undo for 5 seconds. Entries made offline sync in order when the phone is back online and can never duplicate (ids are made on the phone).
- ADD-7 Duplicate any entry with today's date. Long-press the add button for "Same as last time".
- ADD-8 **From outside the app:** the installed app offers "Add expense" and "Scan receipt" when you long-press its icon, and appears in Android's share sheet so a photo, screenshot or text shared from another app opens the add form (5.3).
- ADD-9 If the wording is too loose for the grammar and smart features are on, the text is read by AI into the same form (`docs/AI.md` §3.2). The person always sees the reading before it saves.

### 3.3 Splits and payers [SPL]
- SPL-1 Four ways to split:

| Mode | In the app | Shares |
|---|---|---|
| `ratio` | Split | by percentage; default 50/50; presets 50/50, 60/40, 70/30 and reverses; slider for anything else |
| `exact` | Exact amounts | each person's pounds entered; the remainder shows live; must sum |
| `for_other` | Paid for Sam | Sam owes all of it. Counts in the balance, not in shared-spending figures |
| `treat` | My treat | the payer covers it; nobody owes; counts as shared spending |

- SPL-2 Defaults cascade: this description's usual split → the category's default → the household default (50/50 until both people approve another, 6.3).
- SPL-3 Rounding: largest-remainder in pence; a leftover penny goes to the payer's own share.
- SPL-4 **Who paid:** me or partner. (The owner has no joint account, so a joint-account payer is not built in v1. The data model already supports it: `paid` is a map, so it is an interface addition later, not a redesign.)
- SPL-5 Shares and paid amounts always sum to the amount; the phone and the database both enforce it.

### 3.4 Money back [MB]
- MB-1 A refund, deposit returned or money from selling something shared is a "money back" entry: who received it and whose it is (default: the same split as the original).
- MB-2 "Refund this" on any expense prefills one linked to the original.
- MB-3 Money back reduces shared spending in its category and adjusts the balance the opposite way to an expense.

### 3.5 Settling up [SET]
- SET-1 "Settle up" on Home is prefilled with the full balance; editable for a part payment; date and note optional.
- SET-2 **Pay with Monzo.** If the person owed has saved their monzo.me name, the button opens `https://monzo.me/<name>/<amount>?d=smsm` — the Monzo app opens with the amount filled in. On return, smsm asks "Did it go through?" and records the settle-up on Yes. smsm never moves money itself.
- SET-3 Settle-ups appear in Activity, are editable and soft-deletable, and are logged.
- SET-4 **Settle day** (optional): pick a day of the month; on it both phones get the month's recap with a settle button (4.5, 7).
- SET-5 After a settle-up that brings the balance to zero: the "all square" moment (DESIGN §3.4).

### 3.6 Categories and learning [CAT]
- CAT-1 Twelve starting categories; rename, re-emoji, recolour (from the palette), reorder, archive, add. Archived ones keep their history.
- CAT-2 **Auto-categorise**, in this order, never delaying a save: (1) what this household chose last time for that description; (2) a close match in the household's history; (3) a built-in list of about 250 common UK names and words (`content/merchants.json`); (4) if smart features are on, an AI guess that arrives a moment later and is marked as a guess (`docs/AI.md` §3.3). Otherwise "Other".
- CAT-3 Changing a category teaches the app: next time that description gets your choice. A person's choice always beats a guess.
- CAT-4 The usual split for a description is learned the same way.

### 3.7 Activity, history, comments [ACT]
- ACT-1 Activity lists entries and settle-ups, newest first, grouped by day, with search (description, notes, tags, place) and filters (who paid, category, chapter, country, dates, tag, type).
- ACT-2 Every create, edit, delete and restore is recorded by the database with who and when. An entry's page shows its history ("Sam changed £42.50 to £45.20, yesterday 18:02").
- ACT-3 Delete is soft, with Undo; deleted entries can be restored from history.
- ACT-4 **Comments.** A short thread on any entry ("was this the big shop?"). The partner is notified.
- ACT-5 Either person can edit any entry. Edits are visible, logged and reversible; nothing needs approval except the items in 6.3.

## 4. Features: beyond the daily loop

### 4.1 Recurring and bills [REC]
- REC-1 Weekly, monthly or yearly, every N, with a start date and optional end date, and all the usual fields.
- REC-2 Occurrences post on their date, by the database, once only, whichever phone opens first or neither (a nightly job). Monthly dates anchor to the start date (31 Jan → 28/29 Feb → 31 Mar).
- REC-3 **Amount varies** (energy, water): on the date the bill appears in the Inbox as "Energy is due: how much was it?" with the usual amount offered. It is not money until answered.
- REC-4 **Always home.** Recurring entries are tagged to the home country and to no chapter, even when you are away.
- REC-5 **Suggested.** When the same description has appeared three times at a steady interval with similar amounts, the app offers once to make it recurring.
- REC-6 Editing a template changes future occurrences only; a price change is noted in its history ("Rent £1,450 → £1,500 from March").
- REC-7 **Bills** tab: this month as a calendar (posted and upcoming, with the month's total), the next 30 days as a list, and **Subscriptions**: every active subscription with its monthly and yearly cost and a yearly total.
- REC-8 **What home costs:** the sum of active recurring items as "£2,140 a month to run", shown on Bills.

### 4.2 Chapters [CHP]
A chapter is a named run of spending kept apart from everyday life: a holiday, the wedding, moving house. It replaces "make a separate group".
- CHP-1 A chapter has a name, emoji, kind (trip or project), optional dates and, for trips, a country. Create from Settings, from the add form, or from a trip suggestion (4.3).
- CHP-2 An entry belongs to one chapter or to none ("everyday"). While a chapter is set as current, new manual entries go into it; a chip on the add form shows it and one tap changes it.
- CHP-3 A chapter page shows its total, days, cost per day (trips), spending by category, who paid, places, photos and its entries; and "close chapter" when it's done.
- CHP-4 **One balance.** Chapters separate totals, never debts.
- CHP-5 **Your usual month is protected.** Monthly comparisons, "usual" figures and unusual-spend notes use everyday spending only, so a wedding doesn't make every month look alarming. Totals can be viewed with chapters included.
- CHP-6 Either approach works for a holiday: a chapter, or simply everyday entries tagged with the country (4.3); both can be totalled afterwards.

### 4.3 Places and trips [PLC]
- PLC-1 Every entry has a country (default the home country, GB). Entries can also carry a place name ("Kyoto") and a rough position (rounded to about 100 m).
- PLC-2 With location allowed, an entry dated today picks up the phone's country and town when it is added. The place shows as a chip and can be edited or removed. Location is asked for once, with the reason, and the app works fully without it.
- PLC-3 **Current country.** Each phone keeps a current country. It can be set by hand at any time ("We're in Japan") and is the default for new manual entries on that phone.
- PLC-4 **Trips suggest themselves.** If the phone finds itself in another country, Home offers "Looks like you're in Japan. Start a trip?" One tap creates the chapter and sets the country. When the phone is home again: "Welcome home. Close Japan? 9 days, £1,840."
- PLC-5 Recurring entries ignore all of this (REC-4).
- PLC-6 **Paid in another currency.** In another country the amount field offers that country's currency with the day's rate filled in and editable; the entry stores pounds, and keeps the original amount and rate for reference. Card payments already in pounds are entered as normal. There is one currency of account: GBP.
- PLC-7 Filters and Insights can total by country and by place.

### 4.4 Inbox [INB]
One place for things that need a decision before they count.
- INB-1 Holds: variable bills awaiting an amount (REC-3), receipts saved to sort later (5.1), things shared into the app while offline, import rows being reviewed (8.1), and later Monzo transactions (9).
- INB-2 Each item: **Keep** (opens prefilled; saving makes it an entry) or **Not ours** (dismissed). Home shows a count when it isn't empty; the app icon shows a badge.
- INB-3 Inbox items are never counted in the balance or any figure.

### 4.5 Insights and the monthly recap [INS]
All figures cover shared spending: live entries in `ratio`, `exact` and `treat`, less money back. `for_other` and settle-ups are excluded. Every figure can be tapped for a one-line definition (`docs/DATA_MODEL.md` §5).

- INS-1 **The month so far** on Home: one line ("£1,240 so far · about £80 under your usual pace") and at most one note.
- INS-2 **The recap.** On the 1st (or on settle day) each month gets a recap: one screen, five parts, nothing more.
  1. A headline sentence: "November cost £2,340 together, about £120 less than usual."
  2. One picture: a single bar showing where it went (top four categories and the rest).
  3. Up to three notes on what changed, chosen by size ("Eating out was up £85", "Energy came in at £96").
  4. Between you: what each paid, and the balance, with Settle up.
  5. One moment: the month's biggest or most-commented entry, with its photo if it has one.

  The figures are computed; with smart features on, the two sentences of wording are written from those figures (`docs/AI.md` §3.4); otherwise a template writes them. Past recaps live under Insights.
- INS-3 **Notes** are rule-based and each states its rule: a category at least 30% and £20 above its usual; an entry at least 3× its category's median; a subscription whose price changed; a new recurring cost. "Usual" is the median of the previous three to six everyday months.
- INS-4 **Insights tab:** period selector (month, 3 months, 12 months, year, a chapter); total and comparison; by category; trend over 12 months; who paid; by country; recaps.
- INS-5 **Fairness.** Over 3 and 12 months: each person's share of what was paid, beside your agreed split. Plain words, no judgement.
- INS-6 **Standing-order hint.** If the same person has owed at the end of each of the last three months, by £50 or more on average, a note suggests the monthly amount that would keep you about square.
- INS-7 **Year in review** for any calendar year, as a short set of cards; offered through January.
- INS-8 **On this day.** Occasionally, a card for an entry from a year ago that has a photo, a comment or a chapter ("A year ago: Dishoom, £86, in London").
- INS-9 **Ask smsm.** A question box in Insights: "how much did we spend on eating out in Japan?", "what did the wedding cost so far?". AI turns the question into a filter; code runs it and shows the figure with the filter as editable chips and the matching entries beneath (`docs/AI.md` §3.5).

## 5. Smart features (Gemini)

All optional, all behind one switch in Settings, all with a non-AI fallback. Contracts, limits, privacy and tests are in `docs/AI.md`.

### 5.1 Scan a receipt [SCAN]
- SCAN-1 From the add form or the app-icon shortcut: take or choose a photo. Within a few seconds the form fills with place, date, total and suggested category; the photo is kept as the attachment.
- SCAN-2 **Itemise.** The receipt's lines appear as a list, all ticked as shared. Untick the ones that are just one person's; the amount updates. This is where scanning beats typing.
- SCAN-3 If the lines don't add up to the total, the form says so and trusts neither: the person sets the amount.
- SCAN-4 "Sort it later" puts the photo in the Inbox.
- SCAN-5 Nothing is saved until the person taps Save. If AI is off, slow or over its daily limit, the photo is attached and the form is filled by hand.

### 5.2 Understanding loose wording
ADD-9, CAT-2 step 4, INS-2 wording, INS-9.

### 5.3 Shared into the app
A screenshot of an order confirmation or a photo of a bill shared from another app goes through the same reading as a receipt.

## 6. People, settings, approvals

### 6.1 Setup [PPL]
- PPL-1 Sign in with an emailed 6-digit code. The first person starts the household and picks a name and animal; Settings shows a 6-character join code with a share button.
- PPL-2 The second person signs in, enters the code, and picks a name and the remaining animal. A third person is refused.

### 6.2 Identity
- PPL-3 A name (1–24 characters, any script) and an animal, cat or dog; the two people differ.
- PPL-4 Once saved, both are locked. A change, including swapping animals, is a request the partner must approve. The database enforces this.

### 6.3 Changes that need both people
- PPL-5 Identity and the household default split. A pending request shows as a banner for the partner (Approve / Decline) and as "Waiting for Sam" for the requester, who can cancel.

### 6.4 Settings
Names and animals; default split; monzo.me name; settle day; home country and current country; location on/off; smart features on/off; categories; chapters; recurring; import rules; notifications; join code (until full); export and backup; history; theme; report a problem; version.

## 7. Notifications and the phone [NOT]
- NOT-1 Web push, each type its own switch: a shared bill posts tomorrow (on); partner added, changed or commented, bundled at most hourly (on); recap ready or settle day (on); balance above a chosen amount for 30 days (off); an approval is waiting (always on).
- NOT-2 Tapping a notification opens the thing it is about.
- NOT-3 App-icon shortcuts (Add expense, Scan receipt, Settle up); share target; icon badge for Inbox and approvals.

## 8. Import, export, backup
### 8.1 Import [IMP]
- IMP-1 CSV import with presets for **Splitwise** (bring your history across), **Monzo** statements, and a generic column-mapping step. The file is read on the phone.
- IMP-2 Splitwise import maps payers and shares into entries and settle-ups, and shows the resulting balance beside Splitwise's own before anything is saved.
- IMP-3 Bank rows go through the Inbox one card at a time: Keep or Not ours, with "always do this for Tesco". Discarded rows are never stored; only a hash of the bank's id is kept so they don't reappear. Kept rows can't be imported twice.
### 8.2 Export and backup [EXP]
- EXP-1 CSV of entries and settle-ups for any range; a monthly PDF statement; a full JSON backup that can be restored.
- EXP-2 A nightly automatic backup of the household's data is kept for 14 days in the household's own storage.

## 9. Later: Monzo, live (not in v1)

What Monzo's developer API allows (checked November 2026): reading accounts including joint ones, balances and transactions; webhooks when a transaction is created; attaching receipts to transactions; moving money to and from the user's own pots. It does **not** allow sending a payment to another person, so in-app payments are not possible through it; the monzo.me handoff (SET-2) is the route, and v1 already has it. Access is for personal use by a few named users, which fits. Full history is only readable in the first five minutes after approval (90 days after that), and spending from pot-linked virtual cards is not exposed.

Plan:
- Each person connects their Monzo account in Settings (approved in the Monzo app). Tokens are held server-side only.
- A webhook delivers each new transaction within seconds to the Inbox, with a notification: "Tesco £42.50. Ours?" Keep / Not ours. Rules keep or skip the obvious ones automatically. Undecided items expire after 14 days, leaving only a hash.
- Kept transactions carry Monzo's merchant name, category, address and position, so place and category need no typing. 
- A transfer between the two of you is recognised and offered as a settle-up, which closes the loop on SET-2 without the "did it go through?" question.
- Optional: push the itemised receipt back onto the Monzo transaction.
- v1 already contains the fields, the Inbox, the rules and the ignore-hashes this needs. v1 must not add anything that assumes typing is the only source of entries.

## 10. Not doing
Groups of more than two; balances in several currencies; bank linking in v1; budgets, savings goals, personal spending, incomes; moving money inside the app; maps; ads; accounts for anyone else.

## 11. Things that must hold everywhere

### 11.1 Offline [OFF]
Only smart features need a connection to be useful. Everything else works without one.
- OFF-1 After the first sign-in on a phone, the app opens and is fully usable with no connection, for as long as needed. The app itself and the household's data are stored on the phone, and the browser is asked to keep that storage (`navigator.storage.persist`).
- OFF-2 **Works offline and syncs later, in order:** add, edit, delete, undo, duplicate, money back, recording a settle-up, comments, tags and notes, categories, chapters, recurring templates, Inbox decisions, attaching a photo (the upload waits).
- OFF-3 **Works offline from the phone's copy:** the balance, Activity with search and filters, Bills, Insights and charts, chapter pages, past recaps (and a recap computed on the phone if the month has turned), reading a CSV for import, and CSV, PDF and JSON export.
- OFF-4 **Waits for a connection, and says so in plain words:** the very first sign-in and joining; the partner's changes arriving; recurring bills posting (a due bill shows as "Rent is due today and will post when you're back online", and is not counted until it posts); approval requests and decisions; place names and the day's exchange rate (the current country and the last rate are used, both editable); opening Monzo; notifications; smart features.
- OFF-5 Waiting changes survive closing the app and restarting the phone, however long they wait. Home shows "3 changes waiting to sync". If the server refuses one after reconnecting, the person is told and the entry is kept for them to fix; nothing is dropped silently.
- OFF-6 Being offline never signs anyone out: a sign-in that can't be refreshed for lack of connection stays valid on the phone and refreshes when the connection returns.
- OFF-7 Both phones offline, both changing things, then both online: they end up identical, with the right balance.

### 11.2 Text in any language [TXT]
- TXT-1 Descriptions, notes, tags, names, and category and chapter names accept any language and script, mixed freely, with emoji.
- TXT-2 Typing with a composing keyboard (Korean, Japanese, Chinese) works everywhere: Enter and Save never fire in the middle of composing a character, and quick add is tested with Hangul composition.
- TXT-3 Search, learned categories and suggestions ignore case and character width and are Unicode-normalised, so 이마트 matches however it was typed, and a category learned for it is applied next time.
- TXT-4 Quick add's command words (`me`, `yesterday`, `treat`, `for`) are English in v1; every other word, in any language, passes through as the description. Amounts accept ordinary and full-width digits. Loose wording in another language is read by the AI parse when smart features are on.
- TXT-5 Receipts in other languages (a Japanese receipt on a trip) are scanned like any other; the place and item names are kept as printed.
- TXT-6 Long and non-Latin text wraps and truncates correctly (by whole characters, using `Intl.Segmenter`); sorting uses `Intl.Collator`; fonts fall back to the system's for scripts the app's font lacks.
- TXT-7 The interface itself is in English in v1. Every interface string lives in one place (`src/ui/strings.ts`) so a Korean interface can be added later without touching screens.

### 11.3 Dates and the passage of time [DAT]
- DAT-1 An entry's date is a calendar date, not a moment. An entry dated 14 November shows as 14 November on both phones, wherever each phone is.
- DAT-2 "Today" for a new entry is the date on that phone (in Japan, Japan's date). Recurring bills post on the UK date.
- DAT-3 Correct across month ends (31st → 28th or 29th → 31st), leap years, the turn of the year (December-to-January comparisons, year in review), and both clock changes (no missing or doubled day). Weeks start on Monday.
- DAT-4 No code reads the clock directly; "now" is passed in. The test suite runs at fixed moments including 31 December 23:59, 29 February and the clock-change Sundays, and a property test simulates several years of a household with recurring bills and asserts none is missed or doubled.
- DAT-5 Nothing is tied to a particular year or to a service's current version: the AI model id is a setting, dependencies are pinned, and the app keeps working with no maintenance. When an outside service changes or disappears (rates, place names, AI), the feature falls back as in OFF-4 and the rest is unaffected.

## 12. Quality bar
- Designed for a 390×800 Android phone in Chrome and as an installed app; works from 320 px; usable on a desktop.
- Home is usable in under a second from a cold start with cached data on a mid-range phone; every tap responds at once.
- Offline behaviour as §11.1.
- WCAG AA in both themes; targets at least 44 px; screen-reader labels; reduced motion respected; system text size respected.
- Row-level security on every table; no secrets in the repo; integer pence everywhere.

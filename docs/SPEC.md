# smsm: product spec

## 1. What smsm is

smsm is a phone app for two people who share a home. It records money either of them spends on shared things and keeps one running answer to "who owes whom". It replaces Splitwise and Tricount for a couple, and beats their paid tiers on the things that matter to two people.

**Scope rule.** smsm tracks shared spending and the debts between the two people. It holds nothing about either person's own finances: no incomes, no personal spending, no budgets, no savings goals, no net worth. When a feature idea needs individual finances to make sense, it is out of scope. (The one bridge is "paid for the other", §3.3, which records a debt, not personal spending.)

**Users.** Exactly two people per household. Each signs in on their own phone. They are equals: there is no admin.

## 2. Release plan

- **v1 (this build):** everything in §3 and §4.
- **Later:** live Monzo sync (§5). v1 includes the data fields it needs, so it is an addition, not a rebuild.

Build order inside v1 is in `docs/BUILD_PLAN.md`. Money logic comes first and is tested hardest.

## 3. Features: money

### 3.1 Adding an expense

Two ways in, both from the home screen:

- **Quick add.** One text box. Typing `42.50 tesco groceries me` and pressing enter saves an expense. Grammar, in any order after the amount:
  - amount: first number in the text (`42.5`, `£42.50`, `1,200`); required
  - category: a word matching a category name or alias, case-insensitive, prefix match allowed (`groc` → Groceries); optional, default the category last used with that description, else Other
  - payer: `me` / `I` / own name / own animal (`dog`) → me; partner's name or animal → partner; optional, default me
  - split keywords: `for <partner>` → paid for the other; `treat` → treat; `60/40` → ratio for this expense; optional, default the category or household default
  - date: `yesterday`, `mon`…`sun` (the most recent such day), `12/11`; optional, default today
  - description: whatever words remain, title-cased; if none, the category name
  - A live preview under the box shows how it was read ("£42.50 · Tesco · Groceries · you paid · split 50/50") before saving. Tapping the preview opens the full form prefilled.
- **Full form.** Amount, description, category, date, who paid, split, notes, tags, receipt photo, itemise, foreign currency. Opens prefilled from the last expense with the same description when one exists.
- **Duplicate.** Any expense can be duplicated with today's date.

Saving is instant (local first, §6) and shows a toast with Undo for 5 seconds.

### 3.2 Splits

Every expense has a split mode. The app turns it into shares: how many pence each person owes. Shares always sum to the amount.

| Mode | Label in UI | Shares |
|---|---|---|
| `ratio` | Split | By percentage. Default 50/50. Per-expense override with a slider or presets (50/50, 60/40, 70/30, and their reverses). |
| `exact` | Exact amounts | Each person's pence entered; must sum to the amount (the form shows the remainder live). |
| `for_other` | Paid for [partner] | Partner owes all of it; payer owes nothing. Excluded from shared-spending analytics (§3.8). |
| `treat` | My treat | Payer covers it all; nobody owes anything. Counts as shared spending. |

**Defaults.** Household default ratio is 50/50. Each category can have its own default ratio (for example Rent 60/40). Changing the household default ratio needs both people to approve (§4.3); category defaults do not.

**Rounding.** Ratio shares are computed in pence with the largest-remainder method; leftover pennies go to the payer's own share, so the partner is never charged a rounding penny. Unit tests must cover odd pence, 1p amounts and 33.3% style ratios.

### 3.3 Paid for the other

When one person buys something that is entirely the other's (a prescription, a haircut), they log it as "Paid for [partner]". The partner owes the full amount. It counts in the balance but not in shared-spending totals, charts, insights or year in review. In lists it shows a small "for [name]" tag.

### 3.4 Balance and settling up

- **Balance** = for every live expense, the payer is owed the other person's share; settlements reduce it. With two people this is one signed number. Formula and worked example: `docs/DATA_MODEL.md` §4.
- **Home shows it in words** with the avatars (`docs/DESIGN.md` §4): "All square", or "[Name] owes [Name] £24.50".
- **Settle up.** One tap from home: prefilled with the full balance, editable for a part payment, with date and an optional note. Recorded as a settlement, shown in history. smsm does not move money; it records that money moved.
- A settlement can be edited or deleted like an expense (soft delete, logged).

### 3.5 Recurring expenses

- Weekly, monthly or yearly, every N periods, a start date, an optional end date, and all the normal expense fields including split.
- Occurrences post automatically on their date. Posting is done by the database (`post_due_recurring`), called when either app opens and nightly by a scheduled job, and can never post the same occurrence twice.
- Monthly dates are anchored to the start date (a bill starting 31 Jan posts on 28/29 Feb, then 31 Mar).
- Posted occurrences are normal expenses (editable; editing one does not change the template). Pausing or ending a template stops future posts.
- A template can be flagged **subscription** (default on for the Subscriptions category).

### 3.6 Bills and subscriptions

A **Bills** tab with three views:
- **This month:** a calendar of recurring occurrences, each marked posted or upcoming, with the month's total.
- **Upcoming:** the next 30 days as a list.
- **Subscriptions:** every active subscription template with its monthly and yearly cost, the combined yearly total, and the date it was started. Sorting by yearly cost. This is the "subscription audit": seeing the yearly figure is the point.

### 3.7 Categories, tags, notes, receipts, itemising

- 12 default categories (in `supabase/schema.sql`), each with emoji and colour. Rename, recolour, re-emoji, reorder, archive, add. Archived categories keep their history.
- **Tags:** free text, autocomplete from past tags (e.g. `#paris2026`). Filterable.
- **Notes:** free text.
- **Receipt photo:** optional attachment for reference (warranties, disputes). Compressed on the phone to ≤ 1600 px long side, JPEG ~0.8, stored in a private Supabase Storage bucket readable only by the household. No text recognition.
- **Itemise:** an expense can be entered as lines (label, amount, shared yes/no). Only shared lines make up the expense amount; unshared lines are kept only as labels and amounts inside that expense so the receipt makes sense later, never counted anywhere. The whole-bill total is shown for reference.

### 3.8 Analytics

All analytics cover **shared spending only**: live expenses in modes `ratio`, `exact` and `treat`. `for_other` and settlements are excluded. Every figure has a one-line definition reachable by tapping it.

- **Overview:** this month's shared total, vs the average of the previous 3 months; spend by category (bar list, sorted); monthly trend (12 months, stacked by top 5 categories + Other).
- **Who paid:** for any period, how much each person paid out and how much each person's share was.
- **Fairness tracker:** over the last 3 and 12 months, each person's share of shared spending vs the default ratio. Plain words: "Over the last 3 months Jae paid 58% of shared costs; your split is 50/50." Purely informational; the balance already settles the debts.
- **Insights** (computed, never AI): up to 3 cards on the home and Insights screens, each with its definition:
  - a category this month is ≥ 30% and ≥ £20 above its 3-month average
  - an expense is ≥ 3× the median expense in its category over 6 months (needs ≥ 5 past expenses in that category)
  - cost per day of shared living this month vs last
  - a subscription's amount changed
- **Year in review:** for any calendar year: total shared spend, by category, biggest month, biggest single expense, most frequent place (description), number of expenses, the fairness figure, subscriptions total. Shown as a swipeable card set; offered on the home screen through January.

### 3.9 Trips and foreign currency

An expense can be entered in another currency with a rate (GBP per unit), prefilled with the last rate used for that currency. The GBP amount is stored and used everywhere; the original amount, currency and rate are shown on the expense. Rates are manual; no rate feed.

### 3.10 Search, filters, history

- **Activity tab:** all expenses and settlements, newest first, grouped by day, with search (description, notes, tags, merchant) and filters (who paid, category, date range, tag, mode, source).
- **Change history:** every create, edit, delete and restore of an expense, settlement or recurring template is logged by the database with who and when (`activity` table). An expense's detail view shows its history ("Sam changed £42.50 → £45.20, yesterday 18:02"). There is also a household-wide history view in Settings.
- Delete is soft with Undo; deleted items can be restored from history.

### 3.11 Import (CSV)

- Import a Monzo CSV statement (and a generic CSV with a column-mapping step). The file is parsed **on the phone**; nothing is uploaded until kept.
- Rows appear in an **inbox**, one card each: swipe or tap **Keep** (becomes an expense, with split and category guessed and editable) or **Not shared** (discarded).
- Discarded rows are never stored. Only a SHA-256 hash of the bank's transaction ID goes into `import_ignores`, so a re-import does not show them again. Kept rows store `source='csv'` and `external_id` = the transaction ID, so a re-import can't duplicate them.
- Rules: "always keep Tesco as Groceries 50/50" and "always skip Pret" can be saved from a card and pre-apply next time (stored per household; rules hold merchant text and a decision only).
- Monzo CSV columns must be checked against a real export before the mapping is finalised (record in `docs/DECISIONS.md`).

### 3.12 Export

- **CSV:** expenses and settlements for any date range.
- **PDF:** a monthly statement (totals, by category, who paid, balance at month end, list of expenses), generated on the phone.
- **Full backup:** everything as JSON, from Settings. Also the migration path if the app ever moves.

## 4. Features: people, settings, notifications

### 4.1 Setup

1. First person signs in (email → 6-digit code), taps **Start a household**, picks name and animal.
2. Settings shows a **join code** (6 characters) and a share button that sends the app link plus the code.
3. Second person installs, signs in, taps **Join**, enters the code, picks name and the remaining animal.
4. Until the second person joins, the first can add expenses; balance shows "Waiting for [partner] to join".

### 4.2 Identity: name and animal

- Each person picks a display name (1–24 characters) and an animal: **cat** or **dog**. The two must differ.
- Once saved, both are **locked**. A change (including swapping animals) is a **change request** that the partner must approve in the app. The requester can cancel. Enforced by the database, not just the UI.

### 4.3 Changes that need both people

Approval requests use one mechanism (`change_requests`): identity changes and the household default ratio. A pending request shows as a banner for the partner with Approve / Decline, and as "Waiting for [name]" for the requester. One pending request per kind at a time.

### 4.4 Settings

Names and animals (locked, "Request a change"); default split (needs approval); categories; recurring templates; import rules; notifications; join code (until full); export and backup; history; theme (system / light / dark); sign out; app version and build.

### 4.5 Notifications (web push)

Per person, each toggle independent:
- **Bills tomorrow:** a recurring shared bill posts tomorrow (one bundled notification per day). Default on.
- **Partner activity:** partner added, edited or deleted something, bundled at most hourly. Default on.
- **Settle-up nudge:** balance has been above a chosen amount for 30 days. Default off.
- **Approval waiting:** partner requested a change. Always on.

Delivered by a Supabase Edge Function on a cron, as in MacroPy (`docs/DEPLOY.md`).

## 5. Later: live Monzo sync (not in v1)

Monzo's developer API is for personal use with a small number of allowed users, which fits two people. Plan:
- Each person registers an OAuth client in the Monzo developer portal and connects their own account in Settings (a separate approval in the Monzo app).
- A Supabase Edge Function holds the tokens (server-side only), refreshes them, and every few hours fetches new transactions.
- New transactions go to a **staging** table that holds rows only until a decision: Keep → expense with `source='monzo'` and `external_id`; Not shared → staging row deleted, hash kept in `import_ignores`. The same inbox and rules as CSV import (§3.11).
- v1 already has: `source`, `external_id`, `merchant`, `external_category`, `account_id`, the `accounts` table, `import_ignores`, and the inbox UI. v1 must not add anything that assumes manual entry is the only source.

## 6. Non-functional requirements

- **Phone first.** Designed for a 390×800 phone; works from 320 px wide; usable on desktop.
- **Installable PWA**, offline-capable: the app shell and the household's data are cached on the phone (IndexedDB). Adding, editing and settling work offline and sync when back online, via an outbox with retries. The balance shown offline is computed from local data and says "offline" discreetly.
- **Sync model:** pull changes since last sync (`updated_at`), push outbox; on conflict, the server row wins and the user's change is kept in history (rare for two people). Realtime (Supabase Realtime) updates the partner's screen within seconds when online.
- **Fast:** home interactive in < 1 s on a mid-range Android from cache; every local action responds instantly.
- **Accessible:** WCAG AA contrast in both themes, tap targets ≥ 44 px, screen-reader labels, reduced motion respected.
- **Private and secure:** row-level security on every table; no secrets in the repo; Supabase anon key only in the client.
- **Exact money:** integer pence everywhere; no floating-point money anywhere in code.

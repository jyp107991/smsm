# smsm: data model and money rules (v2)

`supabase/schema.sql` is the tested baseline: `scripts/test-sql.sh` applies it twice to a scratch PostgreSQL 16 database with an auth stub and runs `tests/sql/schema_test.sql` (all checks pass and every forbidden action is refused; run it to see the counts). In S0 the baseline becomes the first migration (`supabase/migrations/<timestamp>_baseline.sql`, applied by the pipeline with `supabase db push`); `schema.sql` is then kept only as a generated snapshot. Every later change is a new numbered migration with tests in the same commit; applied migrations are never edited. The live project was created with "automatically expose new tables" off and "automatic RLS" on, so every new table needs explicit grants (as in the baseline) and RLS policies.

## 1. Tables

| Table | Holds | Notes |
|---|---|---|
| `households` | one row per couple | `join_code`, `home_country` (GB), `default_ratio` (null = 50/50; approval needed), `joint_enabled`, `joint_ratio` |
| `members` | the two people | `display_name`, `animal`, `locked_at`, `monzo_me`. No direct writes: `set_identity()`, `set_monzo_me()`, change requests |
| `categories` | 12 defaults + custom | `colour` is a palette token name; `default_ratio`; `archived`; `sort` |
| `chapters` | trips and projects | `kind`, `country`, dates, `closed` |
| `expenses` | every entry | `kind` expense / money_back; `paid` and `shares` (jsonb, pence); `paid_via`; `split_mode`, `split_params`; `chapter_id`; `country`, `place`, `lat`, `lng` (3 decimals); itemised `items`; original currency fields (reference only); `receipt_path`; source fields; `refund_of`; soft delete |
| `recurring` | templates | `amount_varies`; `is_subscription`; schedule; `posted_count` |
| `settlements` | "A paid B £x" | `method` monzo / other; soft delete |
| `inbox_items` | things awaiting a decision | sources bill / scan / share / monzo; never counted as money |
| `comments` | threads on entries | author-only edit; soft delete |
| `category_memory` | what the household has taught the app | key → category and usual split; `source` user / ai / seed |
| `import_rules`, `import_ignores` | import decisions | ignores hold only a hash |
| `recaps` | monthly recap | computed `stats`, optional `prose` |
| `change_requests` | approvals | identity, default ratio; one pending per kind |
| `activity` | append-only history | written by triggers and RPCs |
| `accounts` | bank accounts (Monzo later) | |
| `ai_usage`, `client_errors`, `app_config` | operations | usage counts; crash reports (insert-only); `min_client_version` |
| view `member_net` | the balance in SQL | one row per person; the two sum to zero |

**To add in their slices, as migrations with tests:** `push_subscriptions` and `notification_prefs` (port MacroPy's pattern); Storage buckets `receipts` and `backups` (private; object path starts with the household id; policies compare the first path segment with `my_household()`); for Monzo later, `monzo_connections` (tokens, no client access).

## 2. RPCs
`create_household()`, `join_household(code)`, `set_identity(name, animal)`, `set_monzo_me(name)`, `request_change(kind, payload)`, `decide_change(id, approve)`, `post_due_recurring(household?)`, `my_household()`. All `security definer`, all check the caller. `post_due_recurring` turns fixed templates into expenses and "amount varies" templates into inbox items, always at the home country and outside any chapter, and is safe to call from both phones at once.

## 3. Money rules

**Pence only.** Integer pence in SQL (`bigint`) and TypeScript (a branded `Pence` type; `Number.isSafeInteger` asserted at boundaries). Decimals exist only inside `src/core/money.ts` (parse and format). A lint rule bans `parseFloat`, `toFixed` and arithmetic on unbranded money elsewhere.

**Every entry has two maps that each sum to the amount:** `paid` (who handed over the money) and `shares` (whose cost it is).
- One payer: `paid = {payer: amount}`.
- Joint account: `paid` = the amount split by `joint_ratio` (largest remainder, leftover penny to the first member by id, deterministic).
- `for_other`: one payer, whose share is 0. `treat`: `shares = paid`.

**Shares from a ratio** (largest remainder, leftover pennies to the payer):
```
raw_i = amount × pct_i / 100;  floor each;  hand out the remaining pennies by largest fraction,
ties to the payer first (for joint: to the first member by id)
```
£42.51 at 50/50 paid by Jae → Jae 2126, Sam 2125. Sam owes £21.25.

**Net position** (positive = this person is owed), over live rows:
```
net(P) = Σ expenses   ( paid[P] − shares[P] )
       − Σ money_back ( paid[P] − shares[P] )
       + Σ settle-ups P paid   − Σ settle-ups P received
net(Jae) + net(Sam) = 0 always.    Balance sentence: if net(Jae) > 0, "Sam owes Jae £net".
```
Worked example (this is the SQL test): Jae pays Tesco £44.00 at 50/50 (+2200). Jae pays Sam's haircut £30.00, for_other (+3000). Sam treats dinner £60.00 (0). Net(Jae) = 5200. A £100 sofa from the joint account split 70/30: Jae paid 5000, owes 7000 (−2000) → 3200. Jae receives a £20 refund that belongs to both: −(2000 − 1000) → 2200. Sam pays Jae £22.00 → 0: "All square".

One pure function, `src/core/balance.ts`, computes this for the UI and exports; the `member_net` view computes it in SQL; a property test and every two-user end-to-end scenario assert they agree.

**Shared spending** (all analytics): live `expense` rows with `split_mode` in (`ratio`, `exact`, `treat`), at full `amount_pence` on `date`, minus live `money_back` rows in the same category and period. Excludes `for_other` and settle-ups.

**Everyday vs chapters.** "Usual", comparisons and notes use rows with `chapter_id is null`. Totals may include chapters when the person asks.

**Other currency.** `amount_pence = round(original_amount × fx_rate × 100)`, computed once at entry and stored; the original and rate are reference only.

**Itemised.** `amount_pence` = the shared lines, plus the shared lines' proportion of any service charge, minus their proportion of any discount, rounded once; the form shows the working.

## 4. Dates
- An entry's `date` is a calendar date chosen by the person (default: today on their phone). No timestamps are used for "when it was spent".
- All date arithmetic goes through `src/core/dates.ts` (plain `YYYY-MM-DD` strings in, strings out). Server-side "today" is `Europe/London`. Tests run with a fixed clock, including across midnight, month ends, leap day and the two clock changes.

## 5. Definitions shown in the app
| Figure | Definition |
|---|---|
| Shared spend | as §3, for the period |
| Usual | median of the previous 3–6 full months of everyday shared spend (fewer than 3 months of history: not shown) |
| Pace | this month's everyday spend to date ÷ (usual × days elapsed ÷ days in month) − 1 |
| Who paid | Σ `paid[person]` over shared spending |
| Fairness | person's paid ÷ total paid, beside the default ratio |
| Unusual category | this month ≥ 1.3 × usual for that category and ≥ £20 above |
| Unusual entry | ≥ 3 × the category's 6-month median, with ≥ 5 earlier entries |
| What home costs | Σ active recurring, converted to monthly (weekly × 52 ÷ 12 ÷ every; yearly ÷ 12 ÷ every) |
| Subscription yearly cost | monthly × 12 ÷ every, etc. |
| Standing-order hint | mean month-end net over the last 3+ months in the same direction, rounded down to £10 |
| Trip cost per day | chapter total ÷ days from first to last entry |

## 6. Keeping two phones in step
The data is small (a few thousand rows over years), so the design is deliberately simple and uses a well-trodden library, not a hand-built sync engine.
- **Read:** the whole household is loaded with TanStack Query and kept in a cache persisted to IndexedDB, so the app opens instantly and works offline.
- **Write:** every change is an optimistic mutation: the cache updates at once, the request is sent, and on failure the cache rolls back with a message. Offline, mutations queue (persisted) and replay in order when the phone is back. Row ids are made on the phone and writes are upserts, so a retry can't duplicate.
- **Hear:** a Supabase Realtime subscription on the household invalidates the affected queries, so the partner's change appears within seconds. A refetch also runs on open, on reconnect, when the app returns to the foreground, and each time the subscription starts listening (changes made before then were not heard).
- **One window owns the queue:** if the app is open twice on one phone, only the window holding the Web Lock `smsm-queue` restores, saves and sends the queue (stored under its own key, apart from the cache); the other only shows and takes over when the first closes (`src/data/windows.ts`).
- **Conflicts:** last write wins per row; both versions are in `activity`, so nothing is lost and either can be restored. For two people this is enough; do not build merge logic.
- **Stale apps:** on open and before the first write, the app compares its version with `app_config.min_client_version`; an older app refreshes itself first. The service worker shows "Updated. Tap to refresh" when a new version is waiting.
- `post_due_recurring()` is called after sign-in and on the first open of each day.

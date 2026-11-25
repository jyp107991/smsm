# smsm: data model and money rules (v2)

`supabase/schema.sql` is the tested baseline: `scripts/test-sql.sh` applies it twice to a scratch PostgreSQL 16 database with an auth stub and runs `tests/sql/schema_test.sql` (all checks pass and every forbidden action is refused; run it to see the counts). In S0 the baseline becomes the first migration (`supabase/migrations/<timestamp>_baseline.sql`, applied by the pipeline with `supabase db push`); `schema.sql` is then kept only as a generated snapshot. Every later change is a new numbered migration with tests in the same commit; applied migrations are never edited. The live project was created with "automatically expose new tables" off and "automatic RLS" on, so every new table needs explicit grants (as in the baseline) and RLS policies.

## 1. Tables

| Table | Holds | Notes |
|---|---|---|
| `households` | one row per couple | `join_code`, `home_country` (GB), `default_ratio` (null = 50/50; approval needed), `joint_enabled`, `joint_ratio` |
| `members` | the two people | `display_name`, `animal`, `locked_at`, `monzo_me`. No direct writes: `set_identity()`, `set_monzo_me()`, change requests |
| `categories` | 12 defaults + custom | `colour` is a palette token name; `default_ratio`; `archived`; `sort`; `seed_key` (the server's: which starting category it is, e.g. `subscriptions`; kept through a rename; null for a person's own; never written by a phone) |
| `chapters` | trips and projects | `kind`, `country`, dates, `closed` |
| `expenses` | every entry | `owner_id` (S10: null = shared; a member = what their own regular payment posted, all theirs, never changes); `kind` expense / money_back; `paid` and `shares` (jsonb, pence); `paid_via`; `split_mode`, `split_params`; `chapter_id`; `country`, `place`, `lat`, `lng` (3 decimals); itemised `items`; original currency fields (reference only); `receipt_path`; source fields; `refund_of`; soft delete |
| `recurring` | templates | `owner_id` (S10, REC-9: null = shared; a member = their own: all theirs, a fixed amount; only they write it; a change applies from the next payment on); `amount_varies`; `is_subscription` ("Show in Subscriptions"; picking the Subscriptions category turns it on); `notes` (copied onto each entry, or each "amount varies" Inbox bill's payload, it posts from then on); schedule; `posted_count` (the server's); soft delete (`deleted_at`, only once paused or ended; a deleted one never posts or runs again; what it posted stays). `ever_posted` (the server's: "has posted", never cleared). A new start after one has posted: the next payment is the new occurrence nearest to the old next day (`recurring_guard`, `recurring_restart_index`) |
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
| view `member_net` | the balance in SQL | one row per person; the two sum to zero; never counts a personal entry (S10) |
| `notification_prefs` | one person's notification switches (S8) | own row only; written by `set_notification_prefs`; no row = the defaults |
| `push_subscriptions` | each phone allowed to show notifications (S8) | own rows only; written by `save_push_subscription` / `remove_push_subscription` |
| `notification_outbox` | notifications waiting to be sent (S8) | filled by triggers and the daily job, never by phones; no client access |
| `push_config` | the push function's keys, its address and the database's token (S8) | one row; no client access; the public key through `push_public_key()` |

**To add in their slices, as migrations with tests:** Storage buckets `receipts` and `backups` (private; object path starts with the household id; policies compare the first path segment with `my_household()`); for Monzo later, `monzo_connections` (tokens, no client access).

## 2. RPCs
`create_household()`, `join_household(code)`, `set_identity(name, animal)`, `set_monzo_me(name)`, `request_change(kind, payload)`, `decide_change(id, approve)`, `post_due_recurring(household?)`, `my_household()`. All `security definer`, all check the caller. `post_due_recurring` turns fixed templates (not deleted) into expenses and "amount varies" templates into inbox items, always at the home country and outside any chapter, and is safe to call from both phones at once.

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
(S10) Over shared rows only: an entry with an owner (a personal regular payment's) is never in either sum.
```
Worked example (this is the SQL test): Jae pays Tesco £44.00 at 50/50 (+2200). Jae pays Sam's haircut £30.00, for_other (+3000). Sam treats dinner £60.00 (0). Net(Jae) = 5200. A £100 sofa from the joint account split 70/30: Jae paid 5000, owes 7000 (−2000) → 3200. Jae receives a £20 refund that belongs to both: −(2000 − 1000) → 2200. Sam pays Jae £22.00 → 0: "All square".

One pure function, `src/core/balance.ts`, computes this for the UI and exports; the `member_net` view computes it in SQL; a property test and every two-user end-to-end scenario assert they agree.

**Shared spending** (all analytics): live `expense` rows with `split_mode` in (`ratio`, `exact`, `treat`), at full `amount_pence` on `date`, minus live `money_back` rows in the same category and period. Excludes `for_other`, settle-ups and personal entries.

**Personal regular payments** (S10, owner 25 Nov, REC-9…REC-12, INS-10). A template with `owner_id` set is one person's own: `paid` and `shares` are each the whole amount to the owner (`split_mode` treat, by a person), a fixed amount; what it posts carries the same `owner_id`. Both members read them; only the owner writes them (row-level security), and `check_personal` keeps the shape. They are never in a shared figure: `net(P)` and `member_net`/`member_net_on` skip rows with an owner (whatever their maps say), and so do shared spending, usual, pace, the comparison period, notes, the recap, the statement, What home costs, the Bills calendar and Subscriptions, Ask, and Activity's filtered total. Each person's own figures are the same functions over their own entries alone (`core/insights` `ownView`). Changing whose a template is posts what is already due first, as it was; entries never change owner.

**Money back and its original** (S9a, MB-2, MB-3). A money back with `refund_of` is for one of the household's own expenses, never one that was deleted, and never more than it still has to come back (the original's amount less its other live linked money back); an original is never edited below its live linked money back. The phone and the database (`check_refund_limit`, which checks the phone's upsert as the edit it is) refuse otherwise. Deleting the original soft-deletes its live linked money back in the same statement (same `deleted_at`, same person, one notification); restoring the original restores those rows (the same `deleted_at`) as they were, and no others. A row deleted again keeps its first `deleted_at`. A money back whose original is deleted never counts, however it came about: `netPositions` (and so every figure built on it), Insights and `member_net`/`member_net_on` all leave it out.

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
| Pace | this month's everyday spend to date against the usual by today: the mean, over the usual's months (the previous 3–6 full months), of each month's everyday spend dated on or before today's day of the month (on the month's last day each month in full; after the 28th the same distance from that month's end); within £10 is "on" (S9a; was usual × days elapsed ÷ days in month) |
| Comparison period | the same stretch just before (the previous month, 3 or 12 months); none when it starts before the household's first live entry (S9a) |
| Who paid | Σ `paid[person]` over shared spending |
| Fairness | person's paid ÷ total paid, beside the default ratio |
| Unusual category | this month ≥ 1.3 × usual for that category and ≥ £20 above |
| Unusual entry | ≥ 3 × the category's 6-month median, with ≥ 5 earlier entries |
| What home costs | Σ active shared recurring, converted to monthly (weekly × 52 ÷ 12 ÷ every; yearly ÷ 12 ÷ every) |
| A person's own cost (S10) | the same, over their own running regular payments: a month and a year |
| Subscription yearly cost | monthly × 12 ÷ every, etc. |
| Standing-order hint | mean month-end net over the last 3+ months in the same direction, rounded down to £10; none when the household has a settle day or settled up in each of those 3 months (S9a) |
| Trip cost per day | chapter total ÷ days from first to last entry |

## 6. Keeping two phones in step
The data is small (a few thousand rows over years), so the design is deliberately simple and uses a well-trodden library, not a hand-built sync engine.
- **Read:** the whole household is loaded with TanStack Query and kept in a cache persisted to IndexedDB, so the app opens instantly and works offline.
- **Write:** every change is an optimistic mutation: the cache updates at once, the request is sent, and on failure the cache rolls back with a message. Offline, mutations queue (persisted) and replay in order when the phone is back. Row ids are made on the phone and writes are upserts, so a retry can't duplicate.
- **Hear:** a Supabase Realtime subscription on the household invalidates the affected queries, so the partner's change appears within seconds. A refetch also runs on open, on reconnect, when the app returns to the foreground, and each time the subscription starts listening (changes made before then were not heard).
- **One window owns the queue:** if the app is open twice on one phone, only the window holding the Web Lock `smsm-queue` restores, saves and sends the queue (stored under its own key, apart from the cache); the other only shows and takes over when the first closes (`src/data/windows.ts`).
- **Conflicts:** last write wins per row; both versions are in `activity`, so nothing is lost and either can be restored. For two people this is enough; do not build merge logic.
- **Stale apps:** on open and before the first write, the app compares its version with `app_config.min_client_version`; an older app refreshes itself first. When a new version is waiting, a toast says "A new version is ready" with Refresh (S2 polish Q-L1).
- `post_due_recurring()` is called after sign-in and on the first open of each day.

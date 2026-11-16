# smsm: data model and money rules

`supabase/schema.sql` is the draft of record. It was run and tested on PostgreSQL 16 with an auth stub (`tests/sql/`): 15 checks pass and 9 forbidden actions are refused. Extend it; don't rewrite it. Every schema change goes in `supabase/migrations/` as a numbered file, and `tests/sql/` grows with it.

## 1. Tables

| Table | Holds | Notes |
|---|---|---|
| `households` | one row per couple | `join_code`, `currency` (GBP), `default_ratio` (null = 50/50; changed only by an approved request) |
| `members` | the two people | `display_name`, `animal` (cat/dog, unique per household), `locked_at`. No direct updates: `set_identity()` once, then change requests |
| `categories` | 12 defaults + custom | `default_ratio` per category (null = household default), `archived`, `sort` |
| `expenses` | every shared expense | money in pence; `split_mode`, `split_params`, `shares`; itemised `items`; foreign currency fields; `receipt_path`; import/Monzo fields `source`, `external_id`, `merchant`, `external_category`, `account_id`; `recurring_id` + `occurrence_date`; soft delete `deleted_at` |
| `recurring` | recurring templates | `frequency`, `every`, `start_date`, `end_date`, `posted_count`, `is_subscription` |
| `settlements` | "A paid B £x" | soft delete |
| `accounts` | bank accounts (for Monzo later) | `provider`, `external_id`, `owner_id` (null = joint) |
| `import_rules` | inbox rules | `match_text`, `decision` keep/skip, category and split to apply |
| `import_ignores` | discarded import rows | only `sha256(transaction id)` |
| `change_requests` | approvals | kinds `identity`, `default_ratio`; one pending per kind |
| `activity` | append-only history | written only by triggers and RPCs; readable by the household |

**To add in later milestones** (write them as migrations, with tests):
- `push_subscriptions(user_id, endpoint, p256dh, auth, created_at)` and `notification_prefs(user_id, bills_tomorrow bool, partner_activity bool, settle_nudge_pence bigint null)`, both with RLS keyed to `auth.uid()`. Port the pattern from MacroPy (`supabase/schema.sql`, `supabase/functions/remind`).
- Storage bucket `receipts` (private). Object path `{household_id}/{expense_id}.jpg`. Storage policies: select/insert/update/delete allowed when the first path segment equals `my_household()::text`.
- Monzo later: `monzo_connections` (tokens, server-only, no client policies) and `monzo_staging` (rows awaiting a keep/skip decision, deleted on decision).

## 2. RPCs (all `security definer`, all check `auth.uid()`)

| Function | Does |
|---|---|
| `create_household()` | creates household + first member + default categories |
| `join_household(code)` | second person joins; refuses a third |
| `set_identity(name, animal)` | first-time name and animal, then locks |
| `request_change(kind, payload)` | opens a change request (needs the partner present) |
| `decide_change(id, approve)` | partner approves or declines; requester may only cancel; applies identity (including an animal swap) or the default ratio |
| `post_due_recurring(household?)` | posts all due recurring occurrences; idempotent; called on app open and nightly by pg_cron |
| `my_household()` | the caller's household id (used by every policy) |

## 3. Integrity enforced by the database

- Shares sum to `amount_pence`, are non-negative, and only name members; the payer is a member.
- `for_other`: payer's share is 0. `treat`: payer's share is the whole amount.
- No hard deletes of expenses or settlements (no delete policy); soft delete only.
- Locked identity and the default ratio can't be changed except through an approved request.
- Recurring occurrences are unique per `(recurring_id, occurrence_date)`; imports are unique per `(household, source, external_id)`.
- Every create/edit/delete/restore of an expense, settlement or template writes `activity` with the actor and the fields that changed.

The client still validates everything first, so the user sees friendly messages, but the database is the authority.

## 4. Money rules

**Pence only.** All amounts are integer pence (`bigint` in SQL, `number` checked with `Number.isSafeInteger` in TS). Parsing user input to pence is the only place decimals appear (`src/lib/money.ts`).

**Shares from a ratio** (largest remainder, leftover pennies to the payer):
```
raw_i   = amount * pct_i / 100
floor_i = floor(raw_i)
left    = amount - Σ floor_i
give `left` pennies one each in order of largest fractional part; ties → payer first, then the other person
```
Example: £42.51 at 50/50 paid by Jae → raw 2125.5 each → floors 2125/2125, left 1, tie → Jae. Shares Jae 2126, Sam 2125. Sam owes £21.25.

**Balance** (positive = Sam owes Jae), over live (not deleted) rows:
```
balance = Σ_expenses paid by Jae (shares[Sam])  −  Σ_expenses paid by Sam (shares[Jae])
        − Σ_settlements Sam→Jae (amount)        +  Σ_settlements Jae→Sam (amount)
```
Worked example (also in `tests/sql/schema_test.sql`): Jae pays Tesco £44.00 at 50/50 (+2200), Jae pays Sam's haircut £30.00 for_other (+3000), Sam treats dinner £60.00 (0). Balance +5200: "Sam owes Jae £52.00". Sam settles £52.00 → 0: "All square".

Implement balance once, as a pure function in `src/lib/balance.ts`, used by the UI, exports and tests. A database view `household_balance` computing the same figure is used by the settle-up nudge, and a test asserts both agree on randomised data.

**Shared spending** (for all analytics): live expenses with `split_mode in ('ratio','exact','treat')`, counted at full `amount_pence` on `date`. Excludes `for_other` and settlements.

**Foreign currency.** `amount_pence = round(original_amount * fx_rate * 100)`; shares computed from that.

**Itemised.** `amount_pence = Σ items where shared`; must match exactly.

## 5. Analytics definitions (shown in the UI's ⓘ)

| Figure | Definition |
|---|---|
| Shared spend (period) | Σ shared spending with `date` in the period |
| vs usual | this month ÷ mean of the previous 3 full months − 1 |
| Who paid | Σ amount of shared spending by `paid_by` |
| Each person's share | Σ `shares[person]` over shared spending |
| Fairness | person's paid ÷ total shared spend, shown beside the default ratio |
| Cost per day | shared spend this month ÷ days elapsed this month |
| Unusual category | this month ≥ 1.3 × its 3-month mean and ≥ £20 above it |
| Unusual expense | amount ≥ 3 × the category's 6-month median, needs ≥ 5 past expenses |
| Subscription yearly cost | weekly × 52 / every, monthly × 12 / every, yearly ÷ every |

## 6. Sync (client)

- **Local store:** IndexedDB (`idb`) mirrors households, members, categories, expenses, recurring, settlements, change_requests, recent activity, import_rules.
- **Pull:** on open, on reconnect, on a Realtime event, and every 60 s while visible: rows with `updated_at > last_pulled_at` per table (add `updated_at` + trigger to every synced table that lacks it, as a migration).
- **Push:** every local write goes to an outbox (operation, table, row, client id) and is sent in order; retries with backoff; client-generated UUIDs make retries idempotent.
- **Conflicts:** server wins; the losing local edit is shown once as "Sam changed this at the same time; their version was kept" with a button to reapply yours.
- **Realtime:** subscribe to the household's rows; a partner's change appears within seconds.
- Call `post_due_recurring()` after each sign-in and on the first open of each day.

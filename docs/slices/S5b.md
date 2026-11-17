# S5b: the recap, settle day, year in review, on this day, comments

Brief per `docs/ENGINEERING.md` §5.1; the second half of S5 (S5a Insights is `S5.md`). Released by default (owner, 17 Nov). Money figures come from `src/core/insights.ts`; this slice adds no new money rule, only new views of the same figures, plus comments.

## Criteria in scope
INS-2 (template wording; the AI wording is S6), SET-4, INS-7, INS-8, ACT-4 (the partner's notification is S8).

## Decisions made here
- **Recaps are computed on the phone** from the household's rows (`recapOf(month)` in the core), never stored; the `recaps` table stays for S6's AI wording. A month has a recap once it is over (or from settle day on, below).
- **The recap (one screen, five parts)**, route `/recap/YYYY-MM`:
  1. Headline: "October cost £2,340.00 together, about £120 less than usual." (everyday usual of that month, nearest £10; "about the same as usual" within £10; no comparison without a usual).
  2. One stacked bar: the top four categories and "Everything else", each labelled with its amount.
  3. Up to three notes for that month (INS-3 rules, as of the month's last day).
  4. Between you: what each paid that month, and today's balance with Settle up (when someone owes).
  5. One moment: the month's most-commented entry, else its biggest expense, as a link ("Dishoom, £86.00, 12 Oct").
- **Where recaps appear:** Insights has "Recaps", month cards for the last 12 finished months (newest first). Home shows "The recap for October is ready" from the 1st until opened on this phone (localStorage `smsm-recap-seen`, a month).
- **Settle day** (SET-4) is the household's: Settings → "Settle day" (a day 1–28, or Off), stored in `households.settle_day` through an RPC either person may call (logged). From that day of the month the month so far has its recap ("November so far") and Home shows "It's settle day: the recap for November so far" with Settle up. Notifications wait for S8.
- **Year in review** (INS-7), route `/year/YYYY`: a short set of cards: the year's total; the top three categories; the months as 12 columns; the biggest expense; the chapters of that year with their totals; who paid. Offered on Home through January ("Your 2026 in review") until opened, and on Insights for every year with entries.
- **On this day** (INS-8): on Home, at most one card a day: a live entry dated exactly a year ago (same month and day) that has a comment or a chapter (photos arrive in S6): "A year ago: Dishoom, £86.00, in London" (place, else chapter). "Not now" hides it for the day.
- **Comments** (ACT-4): on the entry page, a "Comments" section: the thread oldest first ("Sam: was this the big shop?" with when), a box "Add a comment" (1–500 characters) and Send. Saved through the queue (offline too), realtime to the partner. The author can edit or delete their own (soft delete, "Deleted" shown); nobody can change the other's. Comment count shown on entry rows ("2 comments" in the row's name).

## Data
- Migration: `households.settle_day smallint null check (settle_day between 1 and 28)`, RPC `set_settle_day(day int)` (members only; logged as a household change); comments: `revoke delete`, author-only soft delete through the existing update policy, `log_activity` entity `comment`, realtime publication.
- Data layer: `useComments(expenseId)`, `addComment(expenseId, body)`, `editComment(id, body)`, `deleteComment(id)` through the queue (`MoneyOp` table `comments`); `setSettleDay(day | null)`.
- Core: `recapOf(entries, settlements, people, month, opts)`, `yearOf(entries, chapters, people, year)`, `onThisDay(entries, commentCounts, today)` in `src/core/recap.ts`, using `insights.ts`.

## Interfaces (what the tests are written against)
- Routes `/recap/YYYY-MM` (h1 "October 2026"), `/year/YYYY` (h1 "2026 in review").
- Recap regions: "Headline" (the sentence), "Where it went" (a list, ≤ 5 items incl. "Everything else"), "Notes" (≤ 3), "Between you" (each person's paid, the balance sentence, Settle up when owed), "One moment" (a link).
- Insights: region "Recaps" with links named "October 2026" etc.; region "Years" with links "2026 in review".
- Home: link "The recap for October is ready" (1st onwards, until opened); "It's settle day: the recap for November so far" on settle day; link "Your 2026 in review" in January; region "On this day" with "A year ago: …" and button "Not now".
- Settings: combobox "Settle day" with options "Off" and "1st" … "28th".
- Entry page: region "Comments": list of comments, textbox "Add a comment", button "Send"; own comments have "Edit" and "Delete" (named "Edit comment", "Delete comment").
- Data: `useComments`, `addComment`, `editComment`, `deleteComment`, `setSettleDay`; core `recapOf`, `yearOf`, `onThisDay` (shapes pinned by the tests' header).

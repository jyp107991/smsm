# S2 polish: the full QA pass (17 Nov)

Brief per `docs/ENGINEERING.md` §5.1. Owner's ask after go-live: "quality assure in full for functionality, usability, aesthetics — must be top of the line and premium in feel". Three independent audits (look, use, function) on the demo build and the live sign-in screen; their evidence is in the session scratchpad (`qa-look/`, `qa-use/`, `qa-func/`). Every item below has an id (`Q-…`); each test names the id(s) it covers, plus SPEC ids where one applies. Nothing here adds a feature the spec doesn't ask for; where an item refines a screen beyond the S2 interface contract, the accessible names in `docs/slices/S2.md` change together with the tests.

Out of scope: anything for S3+ (Bills, Insights, recap, chapters, country). Local-dev only: the stale `node_modules` that made demo builds fall back to system fonts (fixed by `npm ci`; CI now fails a build whose font paths don't resolve).

## Wave 1a — money and input safety (highest priority)
- **Q-F1** (ADD-6, SET-1, MB-2) A double tap / repeated Enter on Save, Record it, "Yes" (Did it go through?), Duplicate, Money back Save, or a swipe action records **once**. The row id is made once per form/action instance and passed to `addExpense`/`addSettlement` (a second submit is an idempotent upsert of the same row), and the form ignores submits after the first.
- **Q-F2** A date after the phone's today is refused in the form (plain message, same rule as quick add). Recorded in DECISIONS (SPEC is silent; quick add already refuses).
- **Q-F3** Quick add: `for <person>` after another split word (`70/30 for sam`, `treat for sam`) is not read as the payer; the reading is not confident (Enter opens the form).
- **Q-F4** Delete/Restore are no-ops when the row is already in that state (no second "changed the details" history line).
- **Q-F5** "Refund this" on an exact-split entry starts as the same proportion (largest remainder, ties to the payer), so a partial refund saves without retyping.
- **Q-U1** Enter (Android "Next") in Amount moves to Description; only Enter in Description (or Save) saves. Same in the Exact share fields. Enter in the Settle up amount does not record (Record it does).
- **Q-U2** "Did it go through?" survives the app being closed (stored in IndexedDB, not sessionStorage). After "Not yet", a quiet Home banner stays until answered: "Did Sam’s £20.00 to Jae go through?" Yes · Not yet · Forget it.
- **Q-U3** Quick add: Enter with no readable amount says "Start with an amount, like 12.50"; a comma decimal with exactly two digits ("42,50") reads as £42.50 ("1,200" stays twelve hundred); `cat`/`dog` read as the payer in any position (ADD-1); `enterkeyhint="send"`.

## Wave 1b — the visual system and the chrome
- **Q-L1** The update prompt goes through the one toast system (above the tab bar, z-index right), copy "A new version is ready" with Refresh.
- **Q-L2** One "selected" language: outlines only for keyboard focus. Segmented: the selected segment is a raised `surface` tile in the `sunk` track. Chips: tonal forest fill (`color-mix(in oklch, var(--forest) 14%, var(--sunk))`), forest text, tick. Choice cards (Who paid, animals): `surface` + 1.5 px forest border. Active filter chip: same as chips.
- **Q-L3** Sheet backdrop: a `--scrim` token (warm ink at ~28 % in light, black ~45 % in dark), never a light wash. Contrast checked.
- **Q-L4** Bottom of the screen: the Add expense button never covers content (content padded by its height + 24 px; on narrow phones docked on the tab bar's edge, centred), the tab bar's items grouped (not pushed to the far edges), a rounded focus ring on the pill, no focus box after a tap. Toasts never cover the tab bar, an open sheet's footer, or Quick add.
- **Q-U4** The tab bar and Add button hide only while the on-screen keyboard is really open (`visualViewport`), not whenever a text box has focus. When a sheet's opener has gone (e.g. Settle up after "All square"), focus goes to the balance sentence, never into a text box.
- **Q-L5** Sign-in and the code step carry the brand: the level plank with both animals above "smsm" (code step: the dog curious), field and button on the 20 px margin, no "you@example.com" placeholder. The code field is focused after "Send code" and submits by itself when the sixth digit arrives (paste too). An empty email says "Type your email first".
- **Q-L6** Setup: the Cat and Dog cards align (fixed illustration box), the taken one is clearly taken (dimmed + "Sam is the cat"), 20 px margins.
- **Q-L7** Type hierarchy: screen titles are larger than section headings everywhere (one screen-title token); the balance sentence keeps the largest size.
- **Q-L8** Plank staging: the fulcrum gets the rig outline and rounded corners, a quiet ground tone under it, the plank inset to ~86 % width; in the settle moment the sentence changes when the plank lands. "All square" in moss (DESIGN table). The dog's "curious" and the cat's "sheepish" faces read kindly.
- **Q-L9** Approval banner: the peeking animal sits behind the card's top edge (paws in front); Approve is primary, Decline quiet; copy names the split ("Sam would like new entries split Jae 60 · Sam 40").
- **Q-L10** Offline and waiting changes: one `sunk` pill under the plank with a cloud-off icon: "Offline · 1 waiting to sync" (BAL-5, OFF-3 names unchanged in meaning).
- **Q-L11** Leading text buttons (Delete, Sign out) align to the 20 px margin. The "Other" category shows its colour dot, never "•". The gallery drops the decided-choice sections. The version line stays (S0) but quiet.

## Wave 2 — the Add sheet, Home and Activity (after wave 1 merges; these files overlap)
- **Q-L12** Add sheet top: the amount is the hero (display serif, no box chrome, hairline underline, ghost "0.00"); a sum's result shows inside the field, right-aligned, not on its own reserved line; the suggestions row is never an empty gap (recent descriptions until typing).
- **Q-L13** No browser-default controls: search clear is the app's own X (44 px), Notes has no resize grip, the date is an in-app month grid in a small sheet (the chip then reads "Mon 10 Nov"; picking today selects "Today"), and the split has no native slider.
- **Q-U5** Splits say who: one row "50/50 · Jae 60 · Sam 40 · … · Other" with names (Other: a −/+ stepper in 5 % steps), the heading "How it’s shared"; the quick-add reading names it too ("Sam 60 · Jae 40"). The meaning never flips when the payer changes. In money back the options read for money back ("All Jae’s", "All Sam’s").
- **Q-L14** "More" is a full-width disclosure row "More details" with a turning chevron.
- **Q-U6** Quick add while typing: the box scrolls to near the top so the reading stays above the keyboard; when the reading is complete a small Save button appears in the box; the reading reserves its two lines (no page jump), amount in ink, the rest in ink-2; descriptions are saved with the merchant list's spelling or a capital first letter ("tesco" → "Tesco"; other scripts untouched).
- **Q-U7** Home shows the ledger: "Recent" (the last few entries and settle-ups, grouped by day: Today, Yesterday…), never a blank "Nothing today yet" when there is history. The square state keeps its height (a quiet "Settled up today" line).
- **Q-U8** Toasts say what happened: "Saved Tesco £42.50", "Copied to today" with Open, "Money back saved", Undo → "Removed Tesco". A toast never covers the row it reports.
- **Q-U9** Entry page: "Sam owes Jae £21.25 for this" under the split line; a refunded original shows "£20.00 came back · Today" linking to the money back; history starts with "Jae added this, Mon 18:02".
- **Q-L15** Activity rows: description gets the room (grid `24px 1fr auto auto`), the payer's head next to the amount, tabular figures; the row's accessible name includes who paid ("Big shop, £79.08, Jae paid"). The plank's description names people ("Jae, the dog, is owed; Sam, the cat, owes").
- **Q-U10** Activity filters: "Clear filters" in the empty state and a "Clear all" chip whenever a filter is on; dates add "Last 7 days" and "Pick dates".
- **Q-U11** Settings: the monzo.me name shows a check line ("Sam will pay you at monzo.me/jaepark") and accepts "@jaepark"; "Usual split" moves out from under "Paying each other". Settle up for the person owed reads "Sam paid Jae" / "Record Sam’s payment"; editing a settle-up is titled "Edit settle-up". The discard prompt only appears when something was typed.
- **Q-L16** Emoji sit on a small `sunk` disc so they don't shout over the palette.

## Tests (written first, by a separate agent per wave)
Unit/component tests per item (named with the Q-id and any SPEC id); demo e2e for the interaction ones (double tap, Enter, keyboard, toasts, focus, no native date/slider/search-cancel, selected states not outlines, scrim colour, no overlap of the Add button / toasts with named elements at 320×640 and 390×844, both themes, axe clean). The two-user suite keeps passing (update its locators only where an accessible name changes here). CI: fonts resolve in both builds.

## Owner checkpoint
Before wave 1b and wave 2 merge to main, the owner sees before/after screenshots of each screen (both themes) on the preview link and says yes. Wave 1a (money safety) merges on green without waiting.

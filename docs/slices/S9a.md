# S9a: acceptance fixes, money and correctness

Brief per `docs/ENGINEERING.md` §5.1. Source: `docs/qa/S9-acceptance.md` (fresh acceptance pass, 23 Nov). Released by default (owner, 17 Nov). The UI-only findings and the larger-screen layout are S9b.

Finding 11 is done by the S9 performance work. Finding 22 is not a defect: SPL-3 is read as largest remainder, payer only on a tie (DECISIONS, 23 Nov).

## Fixes, with the rule each test pins

1. **Recap balance is the month's end (INS-2).** "Between you" on a recap for month M shows the balance from every entry and settle-up dated on or before M's last day (as live, deleted rows excluded). It uses the one balance function in `src/core`, never a second calculation. The current month's recap, if shown, uses today.
2. **Quick add abroad (PLC-6).** When the current country's currency isn't GBP, a bare amount in quick add is in that currency. The live reading shows both ("¥2,000 · £10.53 · Ramen · …"). Saving stores pounds with the original amount, currency and rate, exactly as the sheet does for the same input. With no rate known, quick add uses the last rate the phone has for that currency. If it has none, Enter opens the sheet prefilled; it never saves the number as pounds. Home shows the country chip (DESIGN §4.1); tapping it changes the current country.
3. **Search folds punctuation (TXT-3).** Search, learned categories and suggestions also treat ’ ‘ ʼ ′ ' as one character and ignore apostrophes when matching. So "sainsbury's", "sainsburys" and "Sainsbury’s" all find "Sainsbury’s". The fold lives in the core normaliser.
4. **Insights only compares like with like (INS-*).** A comparison period that starts before the household's first entry is not used. When none is left, the comparison line is not shown (or says "Not enough history yet", whichever the screen already uses).
5. **Home pace matches Insights (INS-1).** The pace line never counts a regular payment that hasn't posted yet as money saved. "Usual pace by today" counts only what usually lands by this day of the month, or regular payments are left out of both sides. Pick one, record it, and make Insights use the same definition. A test proves Home and Insights agree on the same data.
6. **Recap headline on one basis (INS-2).** The headline total and its "more/less than usual" use the same set of entries. Chapters stay a separate line unless the recap says it includes them.
7. **Money back (MB-2, MB-3).**
   - "Refund this" prefills the amount still unrefunded (original minus live refunds linked to it), plus the category, payer and split.
   - More than the unrefunded amount is refused with "That's more than the £X still to come back".
   - Deleting an original also soft-deletes its linked money back, in the database, in the same logged action. Restoring the original restores those rows.
   - A money back whose original is deleted never counts.
8. **Changing the payer never changes the split silently.** On an entry "For Sam", changing who paid keeps the shares as they were. If the new combination doesn't affect the balance, the sheet says so in one line ("Sam paid for Sam, so this won't change the balance").
9. **Inbox (DESIGN §4.9).**
   - "Not ours" has Undo on its toast, which puts the item back.
   - A variable bill shows a one-tap "Usually £90.00" answer, using the bill's usual amount.
10. **Filtered Activity shows a total (PLC-7, CHP-6).** When any filter or search is on, a line above the rows reads "12 entries · £340.20". Money back is subtracted and settle-ups are left out. It is computed by core from the full filtered set, not from the rows drawn.
15. **Settle up (SET-1).**
    - Paying more than the balance is refused with "That's more than Sam owes (£761.71)" and a one-tap "Use £761.71".
    - The button names the payer: "Record Jae's payment" when Jae owes, "Record Sam's payment" when Sam owes.
21. **Quick add says why (ADD-*).**
    - Enter on input it can't read ("abc", "30.555 x") shows a short line under the box; it doesn't do nothing.
    - Amounts over the app's maximum get the same message in quick add and the sheet, naming the maximum (currently `MAX_PENCE` in core, if defined; otherwise define one and record it). The sheet no longer says "Write an amount, like 12.50." for a too-large amount.
    - An impossible date ("31/02") says "There's no 31 February" instead of becoming the description.
23. **Standing-order hint.** It isn't shown when the couple's settle rhythm already covers it (they settle monthly or have a settle day). Read where the hint is decided and state the rule in DECISIONS.
24. **One order everywhere.** Home Recent, Activity and the statement order entries by date (newest first), then by when they were added (newest first), then by id. One shared comparator in core.

## Tests (written first, by a separate agent)
- Core: one test for each rule above that has a pure part: month-end balance, the currency of a bare quick-add amount and its conversion, the punctuation fold, the comparison window, the pace definition and Home/Insights agreement, the recap basis, the unrefunded amount, payer change keeping shares, the filtered total, settle-up limits and button label, quick-add error reasons and the maximum, the comparator.
- SQL: deleting an original soft-deletes linked money back in the same action; restore brings it back; a money back over the unrefunded amount is refused by the database; `member_net` excludes orphans.
- Screens (Vitest + RTL): recap shows the month-end figure; quick add in Japan; Activity total line; settle-up refusal and label; Inbox Undo and "Usually"; payer change keeps "For Sam".
- E2E: one walk through recap, quick add abroad and settle-up refusal at 390 in both themes.

## Interfaces
- New UI strings go in `src/ui/strings.ts`. Sentence case, names not "you owe".
- Core functions: put them next to the code they extend. Name them in the tests; the builder implements to those names.

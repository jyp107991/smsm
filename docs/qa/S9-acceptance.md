# S9 acceptance pass (fresh agent, demo ef201e9, 23 Nov 2026; only SPEC.md and DESIGN.md read)
Shots: scratchpad/acceptance/shots/. Demo lets you be only Jae (no person switch) — SET-2, PPL-5, partner arrivals, notifications untested. Balance correct to the penny after 40+ money operations; CSV export and statement agree.

Findings (most important first):
1. Past recaps show today's balance under "Between you" (should be the month-end balance, e.g. Oct ended £688.05). (46-recap-full-0.png, 48-recap-jan.png)
2. Quick add records pounds while abroad: current country Japan, "2000 ramen" saves £2,000.00; no country chip on Home (PLC-6, DESIGN §4.1). (92-quickadd-japan-pounds.png)
3. Search: straight apostrophe "sainsbury's" finds 0 of 24 "Sainsbury’s"; "sainsburys" finds none (TXT-3). (90-search-apostrophe.png)
4. Insights compares against months before the household existed (12 months and This year "more than a year earlier"); data starts 23 May 2025. (91-insights-12m-compare.png)
5. Home pace counts a not-yet-posted bill as savings ("about £950 under your usual pace" because rent posts on the 25th); contradicts Insights (INS-1).
6. Recap headline mixes totals: total includes chapter (Japan £702) but "less than usual" compares everyday only.
7. Money back: amount not prefilled (MB-2); refund larger than the original accepted without warning; deleting the original leaves the refund counting, labelled "Money back for Gamma". (14-refund-sheet.png, 34-refund-orphan.png)
8. Changing payer on a "For Sam" entry flips it to "For Jae" silently (debt reverses).
9. Inbox "Not ours" on a variable bill has no Undo; no one-tap "usually £90.00" answer (DESIGN §4.9).
10. Filtered Activity shows no total (PLC-7, CHP-6). (76-filters.png)
11. Activity slow to open (~600 ms desktop; all rows rendered) — covered by the perf work.
12. Tags half-built: quick add accepts #tag, search finds it, but no Tags field in the sheet (ADD-4), not shown on the entry page, no Tag filter (ACT-1).
13. Chips 36 px tall with no larger hit area (rule 44 px): category, split, date, chapter, suggestion chips.
14. Last save's toast covers the next sheet's fields for 5 s. (23-bad-exact.png, 45-huge.png)
15. Settle up: paying £2,000 against £761.71 accepted silently; when Jae owes the button says "Record it", not "Record Jae's payment".
16. 320×640: quick add and Settle up below the fold on Home; Insights shows no figure before scrolling. (T-home-320-light.png, T-insights-320-dark.png)
17. Recap bar colour-only, no labels/key; small Insights bar labels overflow; recap has no animals; recaps listed as text links, not month cards.
18. Insights "Include chapters" toggle on while its caption starts "Off: …".
19. Chapter page lacks places and photos (CHP-3); its entries have no dates. (53-chapter-japan.png)
20. Gaps: no animal in Inbox; Settings lacks home country, recurring list, history, report a problem (§6.4); tapping a Bills calendar day shows nothing; "Other" has no emoji.
21. Quick add: Enter silently does nothing for "abc", "30.555 x", > £1,000,000; sheet rejects £99,999,999 with "Write an amount, like 12.50."; "31/02" becomes description.
22. Rounding: £7.01 at 60/40 gives the leftover penny to the larger share (Jae £4.21), not the payer (Sam); 50/50 ties go to payer. Check SPL-3.
23. Standing-order hint shows though the couple settles monthly.
24. Home Recent and Activity order same-day entries differently.
Demo-only: Sign out leaves a broken Home (04-signout.png); seeded Japan trip has nonsense categories; reload wipes entries with no note.
Worked well: exact money everywhere, undo/delete/restore and human history, quick-add grammar and learning, yen entry keeps original, Monzo import, All square moment, reduced motion, no overflow at 320/390, AA contrast, CLS 0, no console errors, back gesture closes sheet first.

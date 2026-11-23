# S9b: acceptance fixes, screens and larger screens

Brief per `docs/ENGINEERING.md` §5.1. Sources: `docs/qa/S9-acceptance.md` (findings 12–14, 16–20 and the demo-only notes) and `docs/qa/S9-performance.md` (larger screens L1–L3). Released by default.

## Fixes

12. **Tags (ADD-4, ACT-1).**
    - The add/edit sheet has a Tags field: chips, plus an "Add a tag" text input.
    - The entry page shows the tags.
    - Activity has a Tag filter.
    - Quick add's `#tag` and search keep working.
13. **44 px targets (DESIGN §6).** Every chip (category, split, date, chapter, suggestion, filter) has a hit area of at least 44 × 44 px, through its padding or an invisible extension. The chips' look doesn't change, and nothing overlaps.
14. **Toast never covers a sheet.** While a sheet is open the toast sits above the sheet's top edge, or is dismissed when the sheet opens. Undo stays reachable for its full time.
16. **320 × 640 Home.**
    - Quick add and Settle up are visible without scrolling. Compress the plank and animals at heights below about 700 px.
    - Insights shows its first figure without scrolling at 320 × 640.
17. **Charts.**
    - Recap bars have direct labels (value and name), not colour only.
    - Insights bar labels never overflow: they are abbreviated or put inside the bar.
    - The recap shows the two animals (DESIGN §4.7).
    - Past recaps are listed as month cards (month, total, one line), not text links.
18. **Insights "Include chapters".** The caption describes the current state.
19. **Chapter page (CHP-3).**
    - Lists its places, and its photos if any exist in the data model; if photos aren't in the data model, record a deferral.
    - Its entries show their dates, grouped by day as in Activity.
20. **Gaps.**
    - An animal on the empty Inbox.
    - Settings (DESIGN §6.4) has: home country, the recurring list (a link to Bills), history (a link to Activity's history if it exists), and "Report a problem", which opens the existing problem report.
    - Tapping a Bills calendar day lists that day's bills.
    - "Other" has an emoji.
- **Demo only.**
    - Signing out of the demo returns to the demo's start, never a broken Home.
    - The seeded Japan trip gets sensible categories.
    - The demo says once, quietly, that its entries reset on reload.

## Larger screens (DESIGN §4.11)
- **L1.** From 900 px wide the tabs become a left side rail: the same tab items and badges, with keyboard order kept.
- **L2.** From 900 px: two panes, list left and detail or form right.
  - Activity → entry page; Bills → bill; Inbox → item; Settings → section.
  - Home keeps one column at about 36 rem, centred beside the rail.
  - Content is capped at about 76 rem from 1280 px.
  - From 600 to 899 px: one centred column, at most 36 rem.
- **L3.** From 900 px the add/edit sheet opens in the right pane or as a centred dialog. Pickers (category, date, who paid) open as popovers anchored to their chip or as centred dialogs, never as bottom drawers far from the chip. The tab line doesn't show through the dim.
- The phone layout below 600 px is unchanged, pixel for pixel. The existing e2e snapshots and shots at 320/390 must still pass.
- Same components; no second set of screens.

## Tests (written first, by a separate agent)
- Screens (Vitest + RTL): tags field, entry tags and Tag filter; toast position with a sheet open; Settings items; Bills day tap; chapter dates; recap animals and labels.
- E2E (demo):
  - a 44 px target audit of every chip on Home, the sheet, Activity and Insights, at 390;
  - 320 × 640 above-the-fold checks for Home and Insights;
  - 1280 × 800 and 1024 × 768: the rail is present, the bottom tabs absent, Activity opens an entry in the right pane, a picker opens near its chip, no horizontal overflow, axe clean, both themes;
  - 768 × 1024: one column of at most 36 rem;
  - 390 × 844: the layout is unchanged.

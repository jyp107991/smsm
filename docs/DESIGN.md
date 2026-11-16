# smsm: design

## 1. Principles

- **Clean, highly intuitive, warm.** Two people use this every day for years; it should feel like a calm shared notebook, not a banking app.
- **One thing per screen.** The home screen answers "are we square?" and lets you add an expense. Everything else is one tap away.
- **Friendly, never cutesy.** Warmth comes from the animals, colour and plain language, not from jokes in every label.
- **Numbers are exact and explained.** Every figure can be tapped for a one-line definition.

## 2. Brand

### 2.1 Name
**smsm**, always lowercase, including at the start of a sentence and in the app title.

### 2.2 Logo
ㅅ stacked on ㅁ so the pair reads as a house: ㅅ is the roof, ㅁ the walls.

- ㅅ is slightly wider than ㅁ so it overhangs like eaves (about 115–125% of ㅁ's width). Its two strokes are the same weight and meet at the top; they lean together, quietly suggesting two people.
- ㅁ is a square with softly rounded corners. Optional single detail: a small door gap centred in the bottom stroke. No windows, no chimney. Choose with or without the door by testing both at 48 px.
- Stroke weight is constant and thick (about 12% of the icon's width) with rounded caps and joins, so it survives at 48 px and in monochrome.
- **App icon:** the mark in cream on the terracotta brand colour, with the mark inside the central 66% (Android maskable safe zone). Also produce a monochrome version (Android themed icons), and a favicon.
- **Wordmark:** "smsm" in the UI font at weight 700, letter-spacing −2%. Mark to the left of the wordmark in the header of the sign-in screen only; the app's own header shows no logo.
- Deliver as hand-written SVG (`public/icons/`) and PNGs generated from it at 48, 72, 96, 144, 192, 512 (and 512 maskable). Show 3 variants in `docs/DECISIONS.md` with a screenshot at 48 px, pick the most legible, record why.

### 2.3 Avatars: the cat and the dog
Two original, simple cartoon heads, drawn in SVG (no images, no existing character or brand likeness).

- Style: flat shapes, 2–3 colours each plus ink outline at a consistent weight, round friendly forms, dot eyes. Readable at 32 px.
- **Dog:** warm tan, one floppy ear. **Cat:** soft grey with a cream muzzle, pointed ears.
- Each animal has four expressions, swapped by changing only eyes, brows and mouth paths:
  - `content`: default
  - `happy`: settled up, or just received a settle-up
  - `sheepish`: currently owes the other (small sideways glance, small smile, never sad)
  - `pleased`: is owed (gentle smile). Never smug.
- Each person's animal appears beside their name everywhere: balance, list rows ("paid by"), history, approvals.
- The animals stay still by default. One small motion: when a settle-up is saved, both animals do a short hop toward each other (300 ms, skipped under reduced motion).

## 3. Visual system

### 3.1 Colour (tokens in `src/styles/tokens.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FBF7F1` warm cream | `#1C1916` | page |
| `--surface` | `#FFFFFF` | `#262220` | cards, sheets |
| `--surface-2` | `#F3EDE4` | `#302B27` | inputs, chips |
| `--ink` | `#2B2622` | `#F2ECE4` | text |
| `--ink-2` | `#6E655C` | `#B5ABA0` | secondary text |
| `--line` | `#E7DFD4` | `#3D3732` | hairlines |
| `--brand` | `#D9774B` terracotta | `#E58A5F` | primary buttons, icon, focus |
| `--brand-ink` | `#FFFFFF` | `#1C1916` | text on brand |
| `--good` | `#4E9A6C` sage | `#6FBF8D` | all square, positive |
| `--owe` | `#C98A2E` amber | `#E0A64A` | amounts owed (never red: owing is normal, not an error) |
| `--danger` | `#C2453D` | `#E0645B` | destructive actions only |

Category colours come from the database and are only used as small dots and chart fills. Check every text/background pair for WCAG AA in both themes (automated in QA).

### 3.2 Type
- One family: **Nunito** (rounded, warm; self-hosted via `@fontsource`), weights 400, 600, 700, 800.
- Sizes: 34/40 balance figure (800), 22/28 screen titles (700), 17/24 body (400), 15/20 secondary, 13/16 captions. Numbers use tabular figures.

### 3.3 Shape and space
- 4 px grid; screen padding 20 px; card radius 18 px; button and input radius 14 px; sheet radius 24 px (top corners).
- Shadows: one soft level for floating items only (`0 6px 24px rgba(43,38,34,0.08)`); cards use hairlines, not shadows.
- Icons: Lucide outline, 1.75 px stroke, 22 px.

### 3.4 Motion
- 180–240 ms ease-out for sheets, toasts and list inserts. No bouncing except the settle-up hop.
- `prefers-reduced-motion`: fades only.

## 4. Screens

Bottom tab bar, 4 tabs: **Home · Activity · Bills · Insights**. Settings is the gear in the Home header. The add button lives on Home (and as a small `+` in Activity's header).

### 4.1 Home (first thing you see)

Top to bottom:
1. **Header:** "smsm" wordmark (small, left), approvals banner if any, gear (right).
2. **Balance card** (the hero):
   - Settled: both animals `happy`, side by side, touching. Text: "All square". Sub: "Last settled 3 Nov" (or nothing yet).
   - Owing: owing animal `sheepish` on the left, owed animal `pleased` on the right. Text: "**Sam** owes **Jae**", then the amount large below (`£24.50`). Button: "Settle up" (brand). When the viewer is the one who owes, wording stays third person (names), never "You owe", to keep it light and symmetrical.
   - Offline: tiny "offline · syncs when you're back" under the card.
   - Partner not joined: one animal plus a dashed outline: "Waiting for your partner to join" + "Share invite".
3. **Quick add** box: placeholder "42.50 tesco groceries"; live interpretation chip beneath while typing; enter saves; a "More" button opens the full form.
4. **This month:** shared total with the change vs the 3-month average ("£1,240 · 8% less than usual"), then up to 3 insight cards (§SPEC 3.8).
5. **Recent:** last 5 expenses; "See all" goes to Activity.

### 4.2 Add / edit expense (bottom sheet, full height)
Amount first and largest (numeric keyboard opens immediately), then description (autocomplete from history), category chips (horizontal scroll, most used first), who paid (two avatar toggles), split (segmented: Split · Exact · For [partner] · Treat; the ratio slider appears under Split with presets), date (Today chip, Yesterday chip, picker), then a collapsed "More" section: notes, tags, receipt, itemise, currency, repeat (turns it into a recurring template). Sticky Save button above the keyboard. Every field keyboard-aware; nothing hidden behind the keyboard.

### 4.3 Expense detail
Amount, description, category, date, payer with avatar, split shown as "Jae £21.25 · Sam £21.25", notes, tags, receipt thumbnail, itemised lines, original currency, source ("Imported from Monzo CSV"), history list. Actions: Edit, Duplicate, Delete.

### 4.4 Activity
Search field, filter chips row (Who, Category, Date, Tag, Type), day-grouped list. Row: category emoji dot, description, small "for Sam" or "treat" tag when relevant, payer avatar (20 px), amount right-aligned. Settlements appear as their own row style: "Sam paid Jae £50" with both avatars. Import inbox entry point at the top when an import is in progress.

### 4.5 Bills
Segmented: This month · Upcoming · Subscriptions (SPEC §3.6). Tapping a template opens it for edit/pause/end.

### 4.6 Insights
Period selector (This month · 3 months · 12 months · Year), then: total and comparison, by category, trend chart, who paid, fairness, insight cards, "Year in review" entry. Charts: simple bars and lines, category colours, labels on bars rather than legends where possible, tap a bar for its figure. Every figure has an ⓘ with its definition.

### 4.7 Settings
Grouped list per SPEC §4.4. Locked identity rows show the avatar, name and a padlock with "Request a change".

### 4.8 Sign-in and setup
Sign-in: logo + wordmark, "Shared money for two", email field, "Email me a code", 6-digit code entry with auto-advance and paste support. Setup: Start or Join; name; animal picker (two big cards, the taken one greyed with "[Name] is the cat").

### 4.9 Import inbox
One card at a time: date, merchant, amount, Monzo category. Two big buttons: **Keep** (shows guessed category and split, editable inline) and **Not shared**. Swipe right/left as shortcuts. Counter "12 of 48". "Always do this for [merchant]" checkbox. Finish screen: "Kept 9, skipped 39".

## 5. Copy

- Sentence case everywhere; plain verbs: "Add expense", "Settle up", "Request a change".
- Names, not "you/them", in balance statements. "You" is fine elsewhere ("You added Tesco").
- Money: `£42.50` (pence always shown except in chart axes). Dates: "Today", "Yesterday", "Mon 10 Nov", "10 Nov 2025" for other years.
- Empty states are friendly and useful: Activity empty → "Nothing yet. Add your first shared expense from Home."
- Errors say what happened and what to do: "Couldn't save: you're offline. It'll sync when you're back." (and it does).
- No exclamation marks in errors. Approved small delights: "All square", the settle-up hop.

## 6. Layout rules
- No horizontal overflow at 320 px. No layout shift on load (skeletons sized to content). Safe-area insets respected. Tab bar hides when the keyboard is open.
- Both themes everywhere; follows the system by default.

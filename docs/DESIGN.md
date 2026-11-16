# smsm: design (v2)

## 1. The idea

smsm is the ledger two people keep on the shelf at home. Not a bank, not a dashboard: something made of wood and paper, with two small animals living in it. The palette is a forest and the things built from it: leaf greens, bark and oak, lichen-coloured paper. The warmth comes from material, voice and the two animals; the modernity comes from motion, type and restraint.

**One bold thing, everything else quiet.** The bold thing is the plank on the Home screen: the cat and the dog sit at either end of a wooden plank that tilts with the balance and comes level when you're square. It is the brand, the main figure and the only illustration that moves by itself. Lists, forms and charts around it stay plain and calm.

Principles:
- **A sentence, not a statistic.** The balance is written as a sentence with names in it. Figures everywhere come with words.
- **Material, used sparingly.** Wood appears as the plank, the tab bar's top edge and chapter spines. Leaves appear once, when you settle. Nothing else is decorated.
- **Personal.** Names, the animals, "ours", photos you took, places you went. No generic finance imagery, no coins, no piggy banks, no confetti.
- **Not a card grid.** Lists are ruled lines on paper. Only the things that are objects (the recap, a chapter, an insight note) are cards, and they differ in shape by what they are.

## 2. Brand

### 2.1 Name
**smsm**, always lowercase.

### 2.2 Logo
ㅅ stacked on ㅁ so the pair reads as a house: ㅅ the roof, ㅁ the walls.
- ㅅ is wider than ㅁ (about 120%) so it overhangs like eaves; its two strokes have equal weight and lean together.
- ㅁ is a square with softly rounded corners. At most one detail (a door gap in the bottom stroke); test with and without at 48 px.
- One constant, thick stroke (about 12% of the icon's width), round caps and joins.
- App icon: the mark in birch (`#F6F5EC`) on forest (`#2F5D3A`), inside the central 66% (maskable safe zone). Also a monochrome version for Android themed icons, and a favicon.
- Hand-written SVG in `public/icons/`, PNGs generated from it. Three variants rendered at 48 px go in the gallery for the owner to choose (BUILD_PLAN S0).

### 2.3 The cat and the dog
Original characters, drawn in SVG. No resemblance to any existing character or brand.

**Built as a rig, not as pictures.** Each animal is one small SVG component assembled from named parts: `head`, `ears` (left, right), `eyes`, `brows`, `mouth`, `cheeks`, `body`, `tail`, `paws`. Flat shapes, two or three colours each and one ink outline of constant weight; round, friendly forms; dot eyes. Readable at 24 px (head only) and charming at 120 px (whole body).
- **Dog:** oak-tan coat, one ear flopped, a rounder muzzle. **Cat:** soft ash-grey coat with a birch muzzle and chest, pointed ears, a longer tail.

Variety comes from combining three cheap things, so no extra drawings are ever needed:
- **Mood** (a prop that swaps only eye, brow and mouth paths): `calm`, `happy`, `sheepish`, `pleased`, `curious`, `sleepy`, `surprised`, `proud`. Eight moods × two animals from sixteen tiny path sets.
- **Pose** (which parts render and where): `head`, `sitting`, `peeking` (head and paws over an edge), `curled` (asleep).
- **Motion** (CSS on the named parts, nothing else): blink (every 4–7 s, offset per animal), ear twitch, tail sway or wag, a slow breath, head tilt, hop. Each is a short keyframe on one part; they combine freely. All of it stops under reduced motion.

No image files, no animation library files, no sprite sheets. Each animal is a few kilobytes. A dev-only gallery page shows every mood × pose with motion on and off.

**Where they appear** (always the person's own animal for their things):

| Place | What they do |
|---|---|
| Home plank | sit at each end; moods follow the balance (the one who owes: `sheepish`; the one owed: `pleased`; square: both `happy`, sitting close); idle blink and tail |
| Who paid (form) | two heads as the toggle; the chosen one perks its ears |
| List rows | a 20 px head beside each entry for who paid |
| Saving an entry | the payer's head on the toast gives one nod |
| Settle-up | both hop to the middle of the level plank; a few leaves fall (once) |
| Pull to refresh | your animal peeks over the top edge while it loads |
| Empty Activity | the cat `curled` asleep on the empty line |
| Search with no results | the dog `curious`, head tilted |
| Inbox | your animal `peeking` over the stack; `proud` when it's empty |
| Approval waiting | the requester's animal `peeking` over the banner |
| Offline | both `sleepy`; a small "offline" under the plank |
| Something went wrong | `surprised`, with what happened and what to do |
| Recap | both sitting under the month's name |
| Late at night (after 23:00) | idle moods switch to `sleepy` |
| Notifications | the sender's head as the notification icon |
| Setup | the two as large picker cards; the taken one says "Sam is the cat" |

## 3. Visual system

### 3.1 Colour
Forest, wood and paper. (The owner's reference palette page could not be opened during design; these were built from the brief "natural, green, wood". The gallery in S0 is where the owner confirms or adjusts them.) Defined once as tokens in `src/styles/tokens.css`, written in OKLCH with these sRGB values as the reference, switched with `light-dark()`.

| Token | Light | Dark ("the wood at night") | Use |
|---|---|---|---|
| `--paper` | `#F1F2EA` lichen | `#141B16` | page |
| `--surface` | `#FBFBF6` birch | `#1D2620` | sheets, cards |
| `--sunk` | `#E4E8DA` | `#0F1511` | inputs, chips, wells |
| `--ink` | `#2A2118` bark | `#ECE8DA` | text |
| `--ink-2` | `#655A4D` driftwood | `#A9A694` | secondary text |
| `--line` | `#D9DCCB` | `#2F3A31` | rules |
| `--forest` | `#2F5D3A` | `#8FC49A` | primary actions, links, focus, selected |
| `--on-forest` | `#F6F5EC` | `#10210F` | text on forest |
| `--moss` | `#587A3C` | `#A9C48A` | "all square", positive, fills (large text and shapes only in light) |
| `--walnut` | `#6B4A33` | `#9C7350` | the plank, wood edges, chapter spines |
| `--oak` | `#B88A58` | `#D0A676` | lighter wood, the dog, highlights |
| `--honey` | `#8F5E12` | `#E2B25C` | amounts owed (owing is normal, so never red) |
| `--berry` | `#A3423A` | `#EE8A7E` | destructive actions only |

Measured contrast (WCAG): ink on paper 14.0, ink-2 5.9, forest 6.8, honey 4.9, berry 5.5, on-forest on forest 7.0; dark theme all above 6.3 for text. Honey text is not placed on `--sunk` in light (4.46). An automated test checks every pair that is used.

**Category colours** are twelve muted natural hues named as tokens (`moss, amber, walnut, honey, slate, plum, oak, berry, lake, clay, fern, stone`), each with a light and dark value chosen to be distinguishable from its neighbours (checked for colour-blind confusion in the gallery). They appear only as small dots and chart fills. Charts never rely on colour alone: bars carry labels.

**Where the colours go.** Paper and ink do nine-tenths of every screen. Forest marks what you can press and where you are. Wood is structural: the plank, a 3 px walnut edge on the tab bar, chapter spines. Honey is only ever an amount owed. Moss is only ever good news. If a screen has more than one forest-filled element, one of them is wrong.

**Texture.** One: a faint paper grain on `--paper` (an inline SVG noise filter at about 3% opacity, no image). The plank has a two-tone grain drawn in its SVG. No gradients as decoration, no glass, no glow.

### 3.2 Type
Three candidates are shown in the gallery on the real Home screen; the owner picks by looking.
- **A (recommended): Bricolage Grotesque**, one variable family for everything. Its optical-size and width axes give a characterful, slightly hand-cut display voice for the balance sentence and a calm text voice for lists, from a single file. Warm without being soft-edged.
- **B: Fraunces (soft) for sentences and titles, Figtree for the interface.** More bookish.
- **C: Nunito** throughout. Rounder, gentler, more ordinary.

Whichever is chosen: self-hosted variable font via `@fontsource-variable`, Latin subset preloaded; Korean (and any other script in names or notes) falls through to the system font, and the gallery includes Hangul names to check the pairing. Numbers are tabular in lists and proportional in sentences.

Scale (rem, so the phone's text-size setting is respected): balance sentence 1.75/1.2, weight 650; amount in the sentence one step larger; screen titles 1.375/1.25; body 1.0625/1.5; secondary 0.9375/1.4; captions 0.8125/1.3. Sentence case everywhere; no all-caps labels; no letter-spaced eyebrows.

### 3.3 Shape, space, depth
- 4 px grid; 20 px screen margins.
- Radii differ by what a thing is: fields and chips 12 px; buttons fully rounded; sheets 28 px top corners; the recap card 20 px; chapter cards have a square left edge with a walnut spine (like a notebook) and 16 px on the right. Not one radius everywhere.
- Depth: rules and tone, not shadows. One soft shadow exists, for things that float above the page (sheets, toasts, the add button): `0 8px 28px rgb(42 33 24 / 0.12)`.
- Icons: Lucide, 1.75 px stroke, 22 px, ink colour.

### 3.4 Motion
Motion explains what just happened; nothing moves to decorate.
- Navigation uses the View Transitions API: an entry's row grows into its page (shared amount and description); tabs cross-fade; sheets rise.
- Springs for anything dragged or dropped (sheets, the plank, swipes), via the animation library; CSS `linear()` easing elsewhere. 180–260 ms.
- The balance figure rolls digit by digit when it changes; the plank re-levels with a spring.
- Haptics on Android (`navigator.vibrate`): a 10 ms tick on save, two ticks on settle, none elsewhere.
- One orchestrated moment: settling to zero (plank levels, animals hop together, five or six leaves drift down once, "All square"). About 1.2 s, skippable by touching anything.
- `prefers-reduced-motion`: cross-fades only; the plank shows its tilt without animating; no leaves.

## 4. Screens

Four tabs along the bottom: **Home · Activity · Bills · Insights**. Settings is a gear on Home. The tab bar has a walnut top edge and hides while the keyboard is open. Primary actions sit in the lower half of the screen, in thumb reach.

### 4.1 Home
```
┌──────────────────────────────┐
│ smsm                     ⚙   │
│                              │
│      🐱                      │
│     ─────────────── 🐶       │   the plank, tilted toward
│              ▲               │   whoever is owed
│   Sam owes Jae £24.50        │   the sentence
│   Next one's on Sam          │
│   [ Settle up ]              │
│                              │
│  ┌ 42.50 tesco …        📷 ┐ │   quick add
│  └ £42.50 · Tesco · Groceries│   live reading
│                              │
│  November so far             │
│  £1,240 · about £80 under    │
│  your usual pace             │
│  ─────────────────────────   │
│  Today                       │
│  🛒 Tesco            🐶 £42.50│
│  🍜 Dishoom          🐱 £86.00│
│  See all                     │
├══════════════════════════════┤
│  Home  Activity  Bills  Ins. │
└──────────────────────────────┘
```
- **The plank.** A walnut plank on a small oak pivot. Tilt is proportional to the balance, capped at 8° (reached at about £200, tunable). The person who is owed sits higher; the one who owes sits lower and looks `sheepish`. Level means square. The sentence beneath always says it in words, so the tilt never has to be decoded.
- Banners above the plank only when needed: an approval waiting, Inbox count, a trip suggestion, "the recap for October is ready".
- The chapter and country chips appear beside the quick-add box only when not everyday/home ("Japan 🗾").

### 4.2 Add / edit (bottom sheet, full height)
Amount first and largest, numeric keypad open at once; description with suggestions; category chips (most likely first, guess marked with a small dot); who paid (two heads, plus a joint-account chip if enabled); split (segmented: Split · Exact · For Sam · My treat; the ratio control appears under Split); date (Today, Yesterday, picker). "More" expands: chapter, place, notes, tags, photo, itemise, other currency, repeat. Save stays above the keyboard. The system back gesture closes the sheet (it has its own history entry) and asks before discarding typed changes.

### 4.3 Entry page
Amount and description as the heading; then who paid and the split in words ("Jae paid. Jae £21.25, Sam £21.25"); category, date, chapter, place; photo; lines if itemised; original currency if any; comments; history. Actions: Edit, Duplicate, Refund this, Delete.

### 4.4 Activity
Search field, a row of filter chips, entries grouped by day on ruled lines: category emoji, description, small tags ("for Sam", "treat", "money back", a flag for abroad), the payer's head, the amount right-aligned in tabular figures. Settle-ups are a distinct row: both heads and "Sam paid Jae £50". Swipe a row left to delete (with undo), right to duplicate.

### 4.5 Bills
Segments: This month (calendar with dots, total), Upcoming (list), Subscriptions (list with yearly figures and the total). "What home costs" sits at the top as one sentence.

### 4.6 Insights
Period selector; one sentence and one chart at a time, scrolled vertically: total and comparison; where it went (horizontal bars with labels on the bars); trend (12 slim columns); who paid; by country (only if more than one). Recaps as a row of month cards. The Ask box at the top. Charts are hand-drawn SVG with direct labels, no legends, no gridlines beyond a baseline; tap a mark for its figure.

### 4.7 The recap (one screen)
A tall card: the month's name with both animals; the headline sentence; one stacked bar; up to three short notes; "between you" with Settle up; one moment with its photo. It can be shared as an image between the two of you. Nothing scrolls sideways; nothing auto-plays.

### 4.8 Chapters
A list of notebook-like cards with walnut spines (emoji, name, dates, total). A chapter page reads like a page of that notebook: total and days in a sentence, by category, who paid, places as a line of names, photos as a strip, then entries.

### 4.9 Inbox
One card at a time, large. Keep (forest) and Not ours (plain) as two big buttons; swipe right and left do the same. A counter ("3 of 12"). Variable bills show the usual amount as a one-tap answer.

### 4.10 Sign-in and setup
The logo and "smsm"; one line, "Shared money for two"; email, then a six-box code entry that accepts paste. Start or Join. Name. The two animals as large cards.

### 4.11 Larger screens
From 900 px wide: a two-pane layout (list left, detail or form right), tabs as a side rail. Same components.

## 5. Voice
- Sentence case. Plain verbs. "Add expense", "Settle up", "Not ours", "Request a change".
- Names in balance sentences; "you" elsewhere is fine ("You added Tesco").
- A button says what it does and its toast says it did it: "Save" → "Saved"; "Settle up" → "Settled up".
- Money: `£42.50`, pence always, except chart axes. Dates: "Today", "Yesterday", "Mon 10 Nov", "10 Nov 2025" for other years.
- Empty screens invite the next action: "Nothing yet. Add your first shared expense from Home."
- Errors say what happened and what to do, with no apology and no exclamation mark: "Couldn't reach the server. Your entry is saved on this phone and will sync."
- Permitted small delights: "All square", "Next one's on Sam", "Welcome home". No puns, no emoji in system text beyond category and chapter emoji the people chose.

## 6. Craft rules (how it should feel in the hand)
- Every action updates the screen at once and reconciles with the server afterwards; a failed save puts the entry back with a clear message, never silently loses it.
- No layout shift: skeletons match the final size; fonts are preloaded; images have dimensions.
- The right keyboard for each field (`inputmode="decimal"` for amounts, sensible `enterkeyhint`); the viewport resizes with the keyboard so Save is never covered.
- Edge to edge: safe-area insets respected; the status bar is tinted to match the theme.
- Android's back gesture always does the expected thing (closes the sheet, then the page, then leaves).
- No horizontal overflow at 320 px. Long names and amounts truncate gracefully; Hangul and long words wrap correctly.
- Both themes, following the system unless set.
- Lists of thousands of rows stay smooth (`content-visibility` or virtualisation).

## 7. What to show the owner before building features
The S0 gallery, deployed, viewed on a phone: the three logo variants at icon size; the three type options on the real Home screen; the palette in both themes; the plank at five balances; both animals in every mood and pose with motion; an entry row, the add sheet and a recap card with realistic data. The owner picks and comments once; the choices are recorded in `docs/DECISIONS.md` and only then does feature work rely on them.

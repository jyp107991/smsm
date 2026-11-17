/**
 * Gallery: the palette in both themes, and the fifth colour for the owner to confirm (DESIGN §3.1, D17).
 * Each panel sets its own color-scheme, so the tokens' light-dark() values show side by side.
 */
const TOKEN_ROWS: readonly { name: string; use: string }[] = [
  { name: 'paper', use: 'page' },
  { name: 'surface', use: 'sheets, cards' },
  { name: 'sunk', use: 'inputs, chips, wells' },
  { name: 'ink', use: 'text' },
  { name: 'ink-2', use: 'secondary text' },
  { name: 'line', use: 'rules' },
  { name: 'forest', use: 'actions, focus, selected' },
  { name: 'moss', use: '“All square”, good news' },
  { name: 'walnut', use: 'the plank, wood edges' },
  { name: 'oak', use: 'light wood, the dog' },
  { name: 'honey', use: 'amounts owed' },
  { name: 'berry', use: 'destructive only' },
];

function Panel({ scheme }: { scheme: 'light' | 'dark' }) {
  return (
    <div style={{ colorScheme: scheme }} className="bg-paper text-ink min-w-0 flex-1 rounded-[20px] p-4">
      <p className="mb-3 font-semibold">{scheme === 'light' ? 'Light' : 'Dark (the wood at night)'}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {TOKEN_ROWS.map((t) => (
          <li key={t.name} className="flex items-center gap-3">
            <span aria-hidden="true" className="border-line h-8 w-8 shrink-0 rounded-[10px] border" style={{ background: `var(--${t.name})` }} />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-semibold">{t.name}</span>
              <span className="text-ink-2 block text-[0.8125rem]">{t.use}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FIFTH: readonly { label: string; hex: string; note: string }[] = [
  { label: 'A: pale sage', hex: '#D6D9C7', note: 'As read from your screenshot. Used for inputs, chips and rules in light.' },
  { label: 'B: bottle green', hex: '#2F3D2E', note: 'A dark "wine bottle" green, if that is what the swatch was. It would replace pale sage as an accent; the light theme keeps a pale sage made from the other four.' },
];

export function ColourSection() {
  return (
    <section aria-labelledby="g-colour" className="flex flex-col gap-4">
      <h2 id="g-colour" className="text-[1.375rem] leading-tight font-semibold">Colour</h2>
      <p className="text-ink-2">“Forest Green and Walnut”, in both themes.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Panel scheme="light" />
        <Panel scheme="dark" />
      </div>
      <h3 className="mt-2 text-[1.0625rem] font-semibold">Your fifth colour</h3>
      <p className="text-ink-2">Its code was partly hidden in your screenshot. Which one did you mean?</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {FIFTH.map((f) => (
          <li key={f.hex} className="bg-surface flex items-center gap-3 rounded-[16px] p-3">
            <span aria-hidden="true" className="border-line h-12 w-12 shrink-0 rounded-[12px] border" style={{ background: f.hex }} />
            <span className="min-w-0">
              <span className="block font-semibold">{f.label} <span className="text-ink-2 font-normal">{f.hex}</span></span>
              <span className="text-ink-2 block text-[0.9375rem]">{f.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

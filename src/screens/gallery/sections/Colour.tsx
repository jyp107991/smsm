import { OptionMark, Section } from './Section';

/**
 * Gallery: the palette in both themes, and the fifth colour for the owner to confirm (DESIGN §3.1, D17).
 * Each panel sets its own color-scheme, so the tokens' light-dark() values show side by side.
 */
const TOKEN_ROWS: readonly { name: string; use: string }[] = [
  { name: 'paper', use: 'page' },
  { name: 'surface', use: 'sheets and cards' },
  { name: 'sunk', use: 'fields and chips' },
  { name: 'ink', use: 'text' },
  { name: 'ink-2', use: 'quieter text' },
  { name: 'line', use: 'rules' },
  { name: 'forest', use: 'what you can press' },
  { name: 'moss', use: '“All square”' },
  { name: 'walnut', use: 'the plank' },
  { name: 'oak', use: 'light wood, the dog’s coat' },
  { name: 'honey', use: 'amounts owed' },
  { name: 'berry', use: 'deleting, and nothing else' },
];

function Panel({ scheme }: { scheme: 'light' | 'dark' }) {
  return (
    <div data-scheme={scheme} className="bg-paper text-ink min-w-0 flex-1 rounded-[20px] p-4">
      <h3 className="text-subtitle mt-0 mb-3">{scheme === 'light' ? 'By day' : 'By night'}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {TOKEN_ROWS.map((t) => (
          <li key={t.name} className="flex items-center gap-3">
            <span aria-hidden="true" className="border-line h-8 w-8 shrink-0 rounded-[10px] border" style={{ background: `var(--${t.name})` }} />
            <span className="min-w-0">
              <span className="block text-[0.9375rem]">{t.name}</span>
              <span className="text-ink-2 block text-[0.8125rem]">{t.use}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FIFTH: readonly { letter: string; label: string; hex: string; note: string }[] = [
  { letter: 'A', label: 'Pale sage', hex: '#D6D9C7', note: 'As we read it. Fields, chips and rules by day.' },
  { letter: 'B', label: 'Bottle green', hex: '#2F3D2E', note: 'If the swatch was dark. It would be an accent; the day paper stays pale.' },
];

export function ColourSection() {
  return (
    <Section id="g-colour" title="Colours" ask="Forest green and walnut, by day and by night.">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Panel scheme="light" />
        <Panel scheme="dark" />
      </div>
      <div className="mt-4 flex flex-col gap-1">
        <h3 className="text-subtitle m-0">The fifth colour</h3>
        <p className="text-note m-0">Its code was hidden in your screenshot. Which did you mean?</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {FIFTH.map((f) => (
          <li key={f.hex} className="bg-surface flex items-center gap-3 rounded-[16px] p-4">
            <OptionMark letter={f.letter} />
            <span aria-hidden="true" className="border-line h-12 w-12 shrink-0 rounded-[12px] border" style={{ background: f.hex }} />
            <span className="min-w-0">
              <span className="text-subtitle block">{f.label} <span className="text-secondary text-ink-2">{f.hex}</span></span>
              <span className="text-ink-2 block text-[0.9375rem]">{f.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

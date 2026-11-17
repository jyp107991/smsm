import { Section } from './Section';

/**
 * Gallery: the palette in both themes (DESIGN §3.1, D17; the owner's choices are in DECISIONS).
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

export function ColourSection() {
  return (
    <Section id="g-colour" title="Colours" ask="Forest green and walnut, by day and by night.">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Panel scheme="light" />
        <Panel scheme="dark" />
      </div>
    </Section>
  );
}

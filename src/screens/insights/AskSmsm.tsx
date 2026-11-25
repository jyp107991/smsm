/**
 * Ask smsm (S6b; INS-9, docs/AI.md §3.5): a question box in Insights, shown with smart features on and a connection.
 * The AI only reads the question into a closed filter; the figure is worked out here, with Activity's filter code and
 * Insights' money rules (core/ask). The filter shows as chips: removing one re-runs it on the phone at once. The
 * matching entries are listed beneath, newest first.
 */
import { X } from 'lucide-react';
import { useId, useMemo, useState, type SyntheticEvent } from 'react';
import { answer, askFilter, type AskEntry, type AskLookups, type AskQuery, type Chip } from '../../core/ask';
import { applyFilter } from '../../core/filters';
import { formatPence, pence, type Pence } from '../../core/money';
import type { SplitMode } from '../../core/split';
import { askSmsm, useCategories, useChapters, useDataLayer, useEntries, useOnline, useSmartFeatures, type ExpenseRow } from '../../data';
import { Button, Field } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { countryName } from '../chapters/model';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { EntryRowView } from '../shared/rows';
import { payerOf } from '../shared/words';

const SHOWN = 50;
const COUNTED = new Set<string>(['ratio', 'exact', 'treat']);

const map = (j: unknown): Record<string, number> => (j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, number> : {});

/** Without a chip: the filter as it was, less that one value. */
function without(q: AskQuery, chip: Chip): AskQuery {
  const f = { ...q.filter };
  const drop = <T,>(xs: readonly T[] | undefined, v: T) => xs?.filter((x) => x !== v);
  switch (chip.key) {
    case 'category': f.categories = drop(f.categories, chip.value); break;
    case 'chapter': f.chapters = drop(f.chapters, chip.value); break;
    case 'country': f.countries = drop(f.countries, chip.value); break;
    case 'payer': delete f.payer; break;
    case 'dates': delete f.from; delete f.to; break;
    case 'text': delete f.text; break;
    case 'tag': f.tags = drop(f.tags, chip.value); break;
    case 'mode': f.modes = drop(f.modes, chip.value as SplitMode); break;
  }
  return { ...q, filter: f, chips: q.chips.filter((c) => !(c.key === chip.key && c.value === chip.value)) };
}

export function AskSmsm() {
  const smart = useSmartFeatures();
  const online = useOnline();
  if (!smart || !online) return null;
  return <AskBox />;
}

function AskBox() {
  const layer = useDataLayer();
  const today = layer.today();
  const id = useId();
  const people = usePeople();
  const rows = useEntries().data ?? NO_ENTRIES;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const chapters = useChapters().data;
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<AskQuery | null>(null);
  const [cant, setCant] = useState(false);

  const me = people.me;
  const partner = people.partner;
  const entries = useMemo<(AskEntry & { row: ExpenseRow })[]>(() => rows.map((r) => ({
    row: r, id: r.id, amount: pence(r.amount_pence), paid: map(r.paid) as AskEntry['paid'], deleted: r.deleted_at !== null,
    kind: r.kind === 'money_back' ? 'money_back' : 'expense', description: r.description, notes: r.notes, tags: r.tags, place: r.place,
    payer: payerOf(r.paid, people.list), categoryId: r.category_id, chapterId: r.chapter_id, country: r.country, date: r.date,
    splitMode: r.split_mode as SplitMode, ownerId: r.owner_id ?? null,
  })), [rows, people.list]);
  const lookups = useMemo<AskLookups | null>(() => (me && partner ? {
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    chapters: (chapters ?? []).map((c) => ({ id: c.id, name: c.name })),
    countries: [...new Set(rows.map((r) => r.country))].map((code) => ({ code, name: countryName(code) ?? code })),
    people: [{ id: me.id, name: me.name }, { id: partner.id, name: partner.name }],
    today,
  } : null), [me, partner, categories, chapters, rows, today]);

  const result = useMemo(() => (query && lookups ? answer(entries, query.filter, query.measure, query.groupBy, today, lookups) : null), [query, lookups, entries, today]);
  const matching = useMemo(() => {
    if (!query) return [];
    const modes = query.filter.modes;
    return applyFilter(entries, query.filter)
      .filter((e) => !e.deleted && (e.kind === 'expense' ? e.splitMode !== null && COUNTED.has(e.splitMode) : e.splitMode !== 'for_other'))
      .filter((e) => !modes || modes.length === 0 || (e.splitMode !== null && modes.includes(e.splitMode)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [query, entries]);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q === '' || busy || !lookups) return;
    setBusy(true);
    setCant(false);
    setQuery(null);
    void askSmsm(q).then((r) => {
      setBusy(false);
      const read = r.ok ? askFilter(r.data, lookups) : null;
      if (read) setQuery(read);
      else setCant(true);
    });
  };

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-heading rule-ledger m-0">{strings.ask.title}</h2>
      <form onSubmit={submit} className="flex items-end gap-2">
        <Field
          label={strings.ask.title}
          hint={strings.ask.hint}
          className="min-w-0 flex-1"
          value={question}
          maxLength={300}
          enterKeyHint="search"
          autoComplete="off"
          onChange={(e) => { setQuestion(e.target.value); }}
        />
        <Button type="submit" disabled={question.trim() === '' || busy}>{strings.ask.ask}</Button>
      </form>
      {/* One live line, always there, so a screen reader hears each change (reading, the answer, or what it can do). */}
      <p role="status" className={busy || cant ? 'text-secondary text-ink-2 m-0' : 'text-sentence nums-list m-0'}>
        {busy ? strings.ask.reading : cant ? strings.ask.cant : (query && result ? result.sentence : '')}
      </p>
      {query && result ? (
        <div className="flex flex-col gap-3">
          {query.chips.length > 0 ? (
            <ul aria-label={strings.ask.filters} className="m-0 flex list-none flex-wrap gap-2 p-0">
              {query.chips.map((c) => (
                <li key={`${c.key}:${c.value}`}>
                  <button
                    type="button"
                    aria-label={strings.ask.remove(c.label)}
                    onClick={() => { setQuery(without(query, c)); }}
                    className="bg-sunk text-ink text-secondary press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3"
                  >
                    {c.label}
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {result.groups && result.groups.length > 0 ? (
            <ul aria-label={strings.ask.groups} className="m-0 list-none p-0">
              {result.groups.map((g) => (
                <li key={String(g.key)} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
                  <span className="text-body min-w-0 break-words">{g.label}</span>
                  <span className="text-body nums-list shrink-0">{query.measure === 'count' ? strings.ask.entries(g.figure) : formatPence(g.figure as Pence)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {matching.length > 0 ? (
            <>
              <ul aria-label={strings.ask.matching} className="m-0 list-none p-0">
                {matching.slice(0, SHOWN).map((e) => (
                  <li key={e.id} className="border-line border-b last:border-b-0">
                    <EntryRowView row={e.row} categories={categories} people={people.list} />
                  </li>
                ))}
              </ul>
              {matching.length > SHOWN ? (
                <a
                  href="/activity"
                  onClick={(ev) => { ev.preventDefault(); go({ name: 'activity' }); }}
                  className="text-forest text-body inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {strings.ask.seeAll}
                </a>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

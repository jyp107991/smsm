/**
 * A chapter's page (S4a; CHP-3, DESIGN §4.8): reads like a page of that notebook. The total and days in one
 * sentence, by category, who paid, then its entries; "Add to this chapter" (this phone's current chapter, CHP-2),
 * Edit, Close chapter / Reopen. Every figure is the core's (chapterSummary). One balance: nothing here is a debt.
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { formatPence, pence } from '../../core/money';
import {
  closeChapter, setCurrentChapter, useCategories, useChapters, useCurrentChapter, useDataLayer, useEntries, useSyncStatus,
} from '../../data';
import { Button, ICON, useToast } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { EntryRowView } from '../shared/rows';
import { ChapterSheet, type ChapterEditing } from './ChapterSheet';
import { countryName, datesOf, summaryOf, summarySentence } from './model';

export function ChapterPage({ id }: { id: string }) {
  const layer = useDataLayer();
  const today = layer.today();
  const chapters = useChapters();
  const chapter = chapters.data?.find((c) => c.id === id);
  const entries = useEntries().data ?? NO_ENTRIES;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const current = useCurrentChapter();
  const { pendingIds } = useSyncStatus();
  const toast = useToast();
  const [editing, setEditing] = useState<ChapterEditing>(null);
  const ids = useMemo(() => people.list.map((p) => p.id), [people.list]);
  const summary = useMemo(() => (chapter ? summaryOf(chapter, entries, ids, today) : null), [chapter, entries, ids, today]);
  const rows = useMemo(
    () => entries.filter((e) => e.chapter_id === id && e.deleted_at === null)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.created_at < b.created_at ? 1 : -1)),
    [entries, id],
  );
  const summaryId = useId();
  const catId = useId();
  const payId = useId();
  const entriesId = useId();

  const header = (
    <div className="flex min-h-12 items-center">
      <button
        type="button"
        onClick={() => { go({ name: 'chapters' }); }}
        className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
      >
        <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        {strings.chapters.title}
      </button>
    </div>
  );
  if (!chapter || !summary) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
        {header}
        {chapters.data ? <p className="text-note m-0">{strings.chapters.notFound}</p> : null}
      </div>
    );
  }
  const isCurrent = current === chapter.id;
  const dates = datesOf(chapter, today);
  const country = chapter.kind === 'trip' ? countryName(chapter.country) : null;
  const categoryName = (cid: string | null) => categories.find((c) => c.id === cid)?.name ?? strings.chapters.uncategorised;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex flex-col gap-2">
        {header}
        <h1 className="text-title m-0 flex items-center gap-2 break-words">
          <span aria-hidden="true">{chapter.emoji}</span>
          <span>{chapter.name}</span>
        </h1>
        {dates || country ? <p className="text-secondary text-ink-2 m-0">{[country, dates].filter(Boolean).join(' · ')}</p> : null}
      </header>

      <section aria-labelledby={summaryId} className="border-walnut flex flex-col gap-3 border-l-[6px] pl-4">
        <h2 id={summaryId} className="sr-only">{strings.chapters.summary}</h2>
        <p className="text-sentence nums-list m-0">{summarySentence(chapter, summary)}</p>
        {chapter.closed ? <p className="text-secondary text-ink-2 m-0">{strings.chapters.closedNote}</p> : null}
        {isCurrent ? <p className="text-secondary text-forest m-0">{strings.chapters.addingLine}</p> : null}
      </section>

      <div className="flex flex-wrap gap-3">
        {!chapter.closed ? (
          isCurrent
            ? <Button variant="plain" onClick={() => { setCurrentChapter(null); }}>{strings.chapters.stopAdding}</Button>
            : <Button onClick={() => { setCurrentChapter(chapter.id); }}>{strings.chapters.addTo}</Button>
        ) : null}
        <Button variant="plain" onClick={() => { setEditing({ mode: 'edit', row: chapter }); }}>{strings.chapters.edit}</Button>
        <Button
          variant="plain"
          onClick={() => {
            closeChapter(chapter.id, !chapter.closed);
            toast.show({ message: (chapter.closed ? strings.chapters.reopenedToast : strings.chapters.closedToast)(chapter.name) });
          }}
        >
          {chapter.closed ? strings.chapters.reopen : strings.chapters.close}
        </Button>
      </div>

      {summary.byCategory.length > 0 ? (
        <Figures id={catId} title={strings.chapters.byCategory}>
          {summary.byCategory.map((c) => <Line key={c.categoryId ?? 'none'} label={categoryName(c.categoryId)} amount={formatPence(c.total)} />)}
        </Figures>
      ) : null}
      {rows.length > 0 ? (
        <Figures id={payId} title={strings.chapters.whoPaid}>
          {people.list.map((p) => (
            <Line key={p.id} label={p.name} amount={formatPence(summary.byPerson[p.id] ?? pence(0))} />
          ))}
        </Figures>
      ) : null}

      <section aria-labelledby={entriesId} className="flex flex-col">
        <h2 id={entriesId} className="text-heading rule-ledger m-0">{strings.chapters.entries}</h2>
        {rows.length === 0 ? <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.chapters.noEntries}</p> : (
          <ul aria-labelledby={entriesId} className="m-0 list-none p-0">
            {rows.map((r) => (
              <li key={r.id} className="border-line border-b last:border-b-0">
                <EntryRowView row={r} categories={categories} people={people.list} pending={pendingIds.has(r.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChapterSheet editing={editing} onClose={() => { setEditing(null); }} />
    </div>
  );
}

function Figures({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2 id={id} className="text-heading rule-ledger m-0">{title}</h2>
      <ul aria-labelledby={id} className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

function Line({ label, amount }: { label: string; amount: string }) {
  return (
    <li className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-body min-w-0 break-words">{label}</span>{' '}
      <span className="text-body nums-list shrink-0">{amount}</span>
    </li>
  );
}

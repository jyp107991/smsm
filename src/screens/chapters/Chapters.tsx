/**
 * Chapters (S4a; CHP-1, DESIGN §4.8): the open ones as notebook cards (walnut spine, emoji, name, dates, total),
 * then the closed ones; "Start a chapter".
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { formatPence } from '../../core/money';
import { useChapters, useDataLayer, useEntries, type ChapterRow } from '../../data';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { ChapterSheet, type ChapterEditing } from './ChapterSheet';
import { datesOf, summaryOf } from './model';

const NO_CHAPTERS: ChapterRow[] = [];

export function Chapters() {
  const chapters = useChapters().data ?? NO_CHAPTERS;
  const [editing, setEditing] = useState<ChapterEditing>(null);
  const open = chapters.filter((c) => !c.closed);
  const closed = chapters.filter((c) => c.closed);
  const openId = useId();
  const closedId = useId();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center">
          <button
            type="button"
            onClick={() => { go({ name: 'settings' }); }}
            className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
          >
            <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.chapters.back}
          </button>
        </div>
        <h1 className="text-title m-0">{strings.chapters.title}</h1>
      </header>

      <section className="flex flex-col gap-4">
        {open.length === 0 ? <p className="text-secondary text-ink-2 m-0">{strings.chapters.none}</p> : (
          <ul aria-label={strings.chapters.title} id={openId} className="m-0 flex list-none flex-col gap-3 p-0">
            {open.map((c) => <li key={c.id}><ChapterCard chapter={c} /></li>)}
          </ul>
        )}
        <div>
          <Button variant="plain" onClick={() => { setEditing({ mode: 'new' }); }}>{strings.chapters.start}</Button>
        </div>
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby={closedId} className="flex flex-col gap-3">
          <h2 id={closedId} className="text-heading rule-ledger m-0">{strings.chapters.closedList}</h2>
          <ul aria-labelledby={closedId} className="m-0 flex list-none flex-col gap-3 p-0">
            {closed.map((c) => <li key={c.id}><ChapterCard chapter={c} /></li>)}
          </ul>
        </section>
      ) : null}

      <ChapterSheet editing={editing} onClose={() => { setEditing(null); }} />
    </div>
  );
}

/** A notebook card: a square left edge with a walnut spine, 16 px on the right (DESIGN §2.5). */
function ChapterCard({ chapter }: { chapter: ChapterRow }) {
  const layer = useDataLayer();
  const today = layer.today();
  const entries = useEntries().data ?? NO_ENTRIES;
  const people = usePeople();
  const ids = useMemo(() => people.list.map((p) => p.id), [people.list]);
  const total = useMemo(() => summaryOf(chapter, entries, ids, today).total, [chapter, entries, ids, today]);
  const dates = datesOf(chapter, today);
  const label = [chapter.name, dates, formatPence(total)].filter(Boolean).join(', ');
  return (
    <a
      href={`/chapter/${encodeURIComponent(chapter.id)}`}
      aria-label={label}
      onClick={(e) => { e.preventDefault(); go({ name: 'chapter', id: chapter.id }); }}
      className="bg-surface border-walnut press flex min-h-16 items-center gap-3 rounded-r-[16px] border-l-[6px] py-3 pr-4 pl-4"
    >
      <span aria-hidden="true" className="text-2xl leading-none">{chapter.emoji}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink truncate">{chapter.name}</span>
        {dates ? <span className="text-secondary text-ink-2 truncate">{dates}</span> : null}
      </span>
      <span className="text-body nums-list text-ink shrink-0">{formatPence(total)}</span>
    </a>
  );
}

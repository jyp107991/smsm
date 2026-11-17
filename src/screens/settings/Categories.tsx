/**
 * Categories (S3; CAT-1): the household's categories in order, each with Edit and Move up / Move down; a sheet
 * to rename, re-emoji and recolour from the palette; Archive (its entries keep it; it isn't offered for new
 * ones) and Restore; Add a category, which goes last. Every change goes through the queue, offline too.
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import {
  archiveCategory, CATEGORY_COLOURS, reorderCategories, saveCategory, useCategories, type CategoryColour, type CategoryRow,
} from '../../data';
import { Button, Field, ICON, Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { categoryColour } from '../../ui/tokens';
import { CategoryMark } from '../shared/CategoryMark';
import { NO_CATEGORIES } from '../shared/empty';
import { plainError } from '../shared/plain';

type Editing = { mode: 'new' } | { mode: 'edit'; row: CategoryRow } | null;

export function Categories() {
  const all = useCategories().data ?? NO_CATEGORIES;
  const live = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const [editing, setEditing] = useState<Editing>(null);
  const [n, setN] = useState(0);
  const toast = useToast();
  const listId = useId();

  const move = (i: number, by: -1 | 1) => {
    const order = live.map((c) => c.id);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j] as string, order[i] as string];
    try {
      reorderCategories([...order, ...archived.map((c) => c.id)]);
    } catch (err) {
      toast.show({ message: plainError(err) });
    }
  };
  const open = (e: Exclude<Editing, null>) => { setN((x) => x + 1); setEditing(e); };

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
            {strings.categories.back}
          </button>
        </div>
        <h1 className="text-title m-0">{strings.categories.title}</h1>
      </header>

      <section className="flex flex-col gap-4">
        <ul aria-label={strings.categories.title} id={listId} className="m-0 list-none p-0">
          {live.map((c, i) => (
            <li key={c.id} className="border-line flex min-h-14 items-center gap-1 border-b last:border-b-0">
              <span className="flex min-w-0 flex-1 items-center gap-3 py-2">
                <CategoryMark emoji={c.emoji} colour={c.colour} className="w-6 shrink-0 text-center text-lg" />
                <span className="text-body min-w-0 truncate">{c.name}</span>
              </span>
              <IconButton label={strings.categories.up(c.name)} disabled={i === 0} onClick={() => { move(i, -1); }}>
                <ChevronUp size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
              </IconButton>
              <IconButton label={strings.categories.down(c.name)} disabled={i === live.length - 1} onClick={() => { move(i, 1); }}>
                <ChevronDown size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
              </IconButton>
              <IconButton label={strings.categories.edit(c.name)} onClick={() => { open({ mode: 'edit', row: c }); }}>
                <Pencil size={20} strokeWidth={ICON.stroke} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
        <div>
          <Button variant="plain" onClick={() => { open({ mode: 'new' }); }}>{strings.categories.add}</Button>
        </div>
      </section>

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading rule-ledger m-0">{strings.categories.archived}</h2>
          <p className="text-secondary text-ink-2 m-0">{strings.categories.archiveLine}</p>
          <ul aria-label={strings.categories.archived} className="m-0 list-none p-0">
            {archived.map((c) => (
              <li key={c.id} className="border-line flex min-h-14 items-center gap-3 border-b last:border-b-0">
                <span className="flex min-w-0 flex-1 items-center gap-3 py-2">
                  <CategoryMark emoji={c.emoji} colour={c.colour} className="w-6 shrink-0 text-center text-lg" />
                  <span className="text-body text-ink-2 min-w-0 truncate">{c.name}</span>
                </span>
                <button
                  type="button"
                  aria-label={strings.categories.restore(c.name)}
                  onClick={() => {
                    try { archiveCategory(c.id, false); } catch (err) { toast.show({ message: plainError(err) }); }
                  }}
                  className="text-forest text-secondary press inline-flex min-h-11 items-center rounded-full px-3 font-medium"
                >
                  {strings.entry.restore}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CategorySheet key={n} editing={editing} onClose={() => { setEditing(null); }} />
    </div>
  );
}

function IconButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-ink press inline-flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function CategorySheet({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const row = editing?.mode === 'edit' ? editing.row : undefined;
  const start = { name: row?.name ?? '', emoji: row && row.emoji !== '•' ? row.emoji : '', colour: row ? categoryColour(row.colour) : 'moss' };
  const [f, setF] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const dirty = JSON.stringify(f) !== JSON.stringify(start);

  const save = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (f.name.trim() === '') {
      setError(strings.categories.nameNeeded);
      return;
    }
    try {
      saveCategory({ ...(row ? { id: row.id } : {}), name: f.name, emoji: f.emoji.trim() === '' ? '•' : f.emoji, colour: f.colour });
    } catch (err) {
      setError(plainError(err));
      return;
    }
    onClose();
  };
  const footer = (
    <div className="flex flex-col gap-2">
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      <Button type="submit" form={formId} block>{strings.entry.save}</Button>
    </div>
  );
  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={row ? strings.categories.editTitle : strings.categories.newTitle}
      dirty={dirty}
      footer={footer}
    >
      <form id={formId} onSubmit={save} noValidate className="flex flex-col gap-5">
        <Field label={strings.categories.name} value={f.name} autoComplete="off" autoCapitalize="sentences" onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null); }} />
        <Field label={strings.categories.emoji} value={f.emoji} autoComplete="off" className="max-w-32" onChange={(e) => { setF({ ...f, emoji: e.target.value }); }} />
        <div className="flex flex-col gap-2">
          <span aria-hidden="true" className="text-secondary text-ink-2 font-medium">{strings.categories.colour}</span>
          <ToggleGroup.Root
            type="single"
            aria-label={strings.categories.colour}
            value={f.colour}
            onValueChange={(v) => { if (v) setF({ ...f, colour: v as CategoryColour }); }}
            className="grid grid-cols-6 gap-2"
          >
            {CATEGORY_COLOURS.map((c) => (
              <ToggleGroup.Item
                key={c}
                value={c}
                aria-label={strings.categories.colours[c]}
                className={cx(
                  'press inline-flex size-11 items-center justify-center rounded-full border-2 border-transparent',
                  'data-[state=on]:border-forest',
                )}
              >
                <span aria-hidden="true" className="size-8 rounded-full" style={{ background: `var(--cat-${c})` }} />
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </div>
        {row ? (
          <div>
            <Button variant="plain" onClick={() => { try { archiveCategory(row.id, !row.archived); onClose(); } catch (err) { setError(plainError(err)); } }}>
              {row.archived ? strings.entry.restore : strings.categories.archive}
            </Button>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}

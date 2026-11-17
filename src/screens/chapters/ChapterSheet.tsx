/**
 * "New chapter" / "Edit chapter" (S4a; CHP-1): name, emoji, trip or project, optional start and end on the
 * app's calendar, and for a trip its country. Saving is instant and works offline (the queue).
 */
import { useId, useState, type ReactNode } from 'react';
import { formatDate, type IsoDate } from '../../core/dates';
import { saveChapter, useDataLayer, useHousehold, type ChapterRow } from '../../data';
import { Button, Chip, Choices, Field, Sheet, useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { DateSheet } from '../shared/MonthGrid';
import { plainError } from '../shared/plain';
import { countryList } from './model';

export type ChapterEditing = { mode: 'new'; onSaved?: (id: string) => void } | { mode: 'edit'; row: ChapterRow } | null;

/** One sheet per opening (a new key each time), so every opening starts from its own values. */
export function ChapterSheet({ editing, onClose }: { editing: ChapterEditing; onClose: () => void }) {
  const [opened, setOpened] = useState<{ e: Exclude<ChapterEditing, null>; n: number } | null>(null);
  if (editing !== null && opened?.e !== editing) setOpened({ e: editing, n: (opened?.n ?? 0) + 1 });
  if (!opened) return null;
  return <ChapterForm key={opened.n} editing={opened.e} open={editing !== null} onClose={onClose} />;
}

interface Form { name: string; emoji: string; kind: 'trip' | 'project'; country: string; startDate: IsoDate | null; endDate: IsoDate | null }

function ChapterForm({ editing, open, onClose }: { editing: Exclude<ChapterEditing, null>; open: boolean; onClose: () => void }) {
  const layer = useDataLayer();
  const today = layer.today();
  const toast = useToast();
  const home = useHousehold().data?.home_country ?? 'GB';
  const row = editing.mode === 'edit' ? editing.row : undefined;
  const [start] = useState<Form>(() => ({
    name: row?.name ?? '', emoji: row?.emoji ?? '', kind: row?.kind === 'trip' ? 'trip' : 'project',
    country: row?.country ?? home, startDate: row?.start_date ?? null, endDate: row?.end_date ?? null,
  }));
  const [f, setF] = useState<Form>(start);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const formId = useId();
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (next: Partial<Form>) => { setF({ ...f, ...next }); setError(null); };

  const save = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    let id: string;
    try {
      id = saveChapter({
        ...(row ? { id: row.id } : {}), name: f.name, emoji: f.emoji, kind: f.kind,
        country: f.kind === 'trip' ? f.country : null, startDate: f.startDate, endDate: f.endDate,
      });
    } catch (err) {
      setError(plainError(err));
      return;
    }
    toast.show({ message: strings.chapters.savedToast(f.name.trim()) });
    if (editing.mode === 'new') editing.onSaved?.(id);
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
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={row ? strings.chapters.editTitle : strings.chapters.newTitle}
      dirty={dirty}
      footer={footer}
    >
      <form id={formId} onSubmit={save} noValidate className="flex flex-col gap-5">
        <Field label={strings.chapters.name} value={f.name} placeholder={strings.chapters.namePlaceholder} autoComplete="off" autoCapitalize="words" maxLength={40}
          onChange={(e) => { set({ name: e.target.value }); }} />
        <Field label={strings.chapters.emoji} value={f.emoji} autoComplete="off" className="max-w-32" onChange={(e) => { set({ emoji: e.target.value }); }} />
        <Group label={strings.chapters.kind}>
          <Choices
            label={strings.chapters.kind}
            options={[{ value: 'trip', label: strings.chapters.trip }, { value: 'project', label: strings.chapters.project }]}
            value={f.kind}
            onValueChange={(kind) => { set({ kind }); }}
          />
        </Group>
        <DateChoice label={strings.chapters.starts} value={f.startDate} today={today} onClear={() => { set({ startDate: null }); }} onPick={() => { setPicking('start'); }} />
        <DateChoice label={strings.chapters.ends} value={f.endDate} today={today} onClear={() => { set({ endDate: null }); }} onPick={() => { setPicking('end'); }} />
        {f.kind === 'trip' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${formId}-country`} className="text-secondary text-ink-2 font-medium">{strings.chapters.country}</label>
            <select
              id={`${formId}-country`}
              value={f.country}
              onChange={(e) => { set({ country: e.target.value }); }}
              className="bg-sunk text-ink text-body min-h-12 w-full rounded-[12px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {countryList().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
        ) : null}
      </form>
      <DateSheet
        open={picking !== null}
        onClose={() => { setPicking(null); }}
        value={(picking === 'end' ? f.endDate ?? f.startDate : f.startDate) ?? today}
        today={today}
        max={null}
        onPick={(d) => { set(picking === 'end' ? { endDate: d } : { startDate: d }); }}
      />
    </Sheet>
  );
}

function DateChoice({ label, value, today, onClear, onPick }: { label: string; value: IsoDate | null; today: IsoDate; onClear: () => void; onPick: () => void }) {
  return (
    <Group label={label}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        <Chip selected={value === null} onSelectedChange={onClear}>{strings.chapters.notSet}</Chip>
        <Chip selected={value !== null} aria-haspopup="dialog" onSelectedChange={onPick}>
          {value !== null ? formatDate(value, today) : strings.entry.pickDate}
        </Chip>
      </div>
    </Group>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span aria-hidden="true" className="text-secondary text-ink-2 font-medium">{label}</span>
      {children}
    </div>
  );
}

/**
 * Add expense / Edit expense / Money back (DESIGN §4.2; ADD-3…ADD-7, SPL-1…SPL-5, MB-1, MB-2, CAT-3, CAT-4).
 * Amount first and largest with the numeric keypad open at once; description with earlier ones offered;
 * category chips with the household's guess marked; who paid as the two heads; the split; the date; notes
 * under More. Save is instant and works offline; its toast offers Undo for 5 seconds.
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useId, useMemo, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { formatDay } from '../../core/dates';
import {
  addExpense, deleteExpense, editExpense, rememberChoice, useCategories, useCategoryMemory, useDataLayer,
  useEntries, useHousehold, type ExpenseDraft, type ExpenseRow,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, Chip, Field, Segmented, Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { categoryColour } from '../../ui/tokens';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { Head } from '../shared/Head';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { defaultSplit, descriptionSuggestions, guessFor, otherCategoryId } from '../shared/suggest';
import type { Person } from '../shared/words';
import type { EntryRequest } from '../sheets';
import {
  blankForm, draftOf, formFromRow, RATIO_PRESETS, refundForm, remainderWords, setPayerShare, sumWords, summaryWords,
  withSplit, yesterdayOf, type FormState, type SplitChoice,
} from './form';

export function EntrySheet({ request, onClose }: { request: EntryRequest | null; onClose: () => void }) {
  // A new key per request, so every opening starts from its own prefill; the last one stays while closing.
  const [opened, setOpened] = useState<{ req: EntryRequest; n: number } | null>(null);
  if (request !== null && opened?.req !== request) setOpened({ req: request, n: (opened?.n ?? 0) + 1 });
  if (!opened) return null;
  return <EntryForm key={opened.n} request={opened.req} open={request !== null} onDone={onClose} />;
}

function EntryForm({ request, open, onDone }: { request: EntryRequest; open: boolean; onDone: () => void }) {
  const formId = useId();
  const layer = useDataLayer();
  const toast = useToast();
  const people = usePeople();
  const categories = useCategories().data ?? NO_CATEGORIES;
  const live = useMemo(() => categories.filter((c) => !c.archived), [categories]);
  const entries = useEntries().data ?? NO_ENTRIES;
  const memory = useCategoryMemory();
  const household = useHousehold().data ?? null;
  const today = layer.today();
  const me = people.me;
  const pair = people.list;

  const existing: ExpenseRow | undefined = request.mode === 'edit' ? (entries.find((e) => e.id === request.id) ?? request.row) : undefined;

  // The form starts once, from what was asked; later changes to the lists don't reset what is typed.
  const [initial] = useState((): FormState => {
    if (request.mode === 'edit' && existing) return formFromRow(existing, pair, request.input);
    if (request.mode === 'refund') return refundForm(request.of, pair, today);
    const split = defaultSplit({ remembered: null, category: undefined, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' });
    const blank = blankForm({ me: me?.id ?? '', people: pair, today, split });
    return { ...blank, categoryId: otherCategoryId(live), ...(request.mode === 'add' ? request.prefill : undefined) };
  });
  const [s, setS] = useState<FormState>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(initial.notes !== '');
  const [picking, setPicking] = useState(initial.date !== today && initial.date !== yesterdayOf(today));
  // What the person chose themselves (taught to the app on Save, CAT-3, CAT-4).
  const picked = useRef({
    category: request.mode === 'add' && request.fromQuickAdd?.typedCategory === true,
    split: request.mode === 'add' && request.fromQuickAdd?.typedSplit === true,
  });

  const guess = useMemo(() => guessFor(s.description, { categories, memory, entries }), [s.description, categories, memory, entries]);
  const suggestions = useMemo(() => descriptionSuggestions(s.description, entries), [s.description, entries]);

  const update = (next: FormState) => {
    setS(next);
    setErrors([]);
  };
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  /** A new description: the category and split follow the household's guess until the person picks them. */
  const describe = (description: string) => {
    let next = { ...s, description };
    if (request.mode === 'add') {
      const g = guessFor(description, { categories, memory, entries });
      if (!s.categoryTouched) next = { ...next, categoryId: g.categoryId ?? otherCategoryId(live) };
      if (!s.splitTouched) {
        const category = live.find((c) => c.id === next.categoryId);
        next = withSplit(next, defaultSplit({ remembered: g.split, category, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' }), pair);
      }
    }
    update(next);
  };

  const title = request.mode === 'refund' ? strings.entry.moneyBack
    : request.mode === 'edit' ? (existing?.kind === 'money_back' ? strings.entry.editMoneyBack : strings.entry.edit)
    : strings.entry.add;
  if (!me) return null;
  const payerPerson = pair.find((p) => p.id === s.payer) ?? me;
  const other = pair.find((p) => p.id !== s.payer) ?? null;
  const isBack = s.kind === 'money_back';

  const save = (e?: SyntheticEvent) => {
    e?.preventDefault();
    const description = s.description.trim() !== '' ? s.description : (live.find((c) => c.id === s.categoryId)?.name ?? '');
    const result = draftOf({ ...s, description }, pair);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    const draft = result.draft;
    let id: string;
    let undo: () => void;
    try {
      if (request.mode === 'edit' && existing) {
        id = existing.id;
        const before = draftOf(initial, pair);
        // Only what changed is sent: a new description or date never rebuilds the money (ACT-5).
        const patch = 'draft' in before ? changedFields(before.draft, draft, picked.current.split) : draft;
        editExpense(id, patch);
        // Undo sends back only what the edit changed: the split only if it differs, so undoing a rename
        // never rebuilds the money (a joint-account entry can't be rebuilt at all).
        undo = () => {
          if ('draft' in before) editExpense(id, changedFields(draft, before.draft, false));
        };
      } else {
        id = addExpense(draft);
        undo = () => { deleteExpense(id); };
      }
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    // CAT-3, CAT-4: what the person chose teaches the app (never delays the save: it is queued).
    const learned: { categoryId?: string | null; split?: ExpenseDraft['split'] } = {};
    if (picked.current.category) learned.categoryId = draft.categoryId;
    if (picked.current.split) learned.split = draft.split;
    if (!isBack) {
      try {
        rememberChoice(draft.description, learned);
      } catch {
        /* learning is a nicety; the entry is saved */
      }
    }
    tickSaved();
    toast.show({
      message: strings.entry.saved,
      icon: <Head animal={payerPerson.animal} size={24} nod />,
      action: { label: strings.entry.undo, onAction: undo },
      duration: 5000,
    });
    onDone();
  };

  const splitOptions: { value: SplitChoice; label: string }[] = [
    { value: 'ratio', label: strings.entry.split },
    { value: 'exact', label: strings.entry.exact },
    { value: 'for_other', label: strings.entry.forOther(other?.name ?? '') },
    { value: 'treat', label: s.payer === me.id ? strings.entry.myTreat : strings.entry.theirTreat(payerPerson.name) },
  ];
  const remainder = remainderWords(s, pair);
  const summary = summaryWords(s, pair);
  const sum = sumWords(s);
  const payerPct = s.ratio[s.payer] ?? 50;

  const footer = (
    <div className="flex flex-col gap-2">
      <p className="text-secondary text-ink-2 nums-list m-0 min-h-[1.4rem] truncate">{summary}</p>
      {errors.length > 0 ? <p role="alert" className="text-secondary text-berry m-0">{errors.join(' ')}</p> : null}
      <Button type="submit" form={formId} block>{strings.entry.save}</Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onDone(); }} title={title} dirty={dirty} full footer={footer}>
    <form id={formId} onSubmit={save} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Field
          label={strings.entry.amount}
          variant="amount"
          value={s.amountText}
          onChange={(e) => { update({ ...s, amountText: e.target.value }); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="next"
          autoFocus={request.mode !== 'edit'}
        />
        <p className="text-secondary text-ink-2 nums-list m-0 min-h-[1.3rem]" aria-live="polite">{sum}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Field
          label={strings.entry.description}
          value={s.description}
          placeholder={strings.entry.descriptionPlaceholder}
          onChange={(e) => { describe(e.target.value); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        {/* A fixed-height row, so suggestions appearing never push the form down. */}
        <div className="flex h-11 min-w-0 items-center gap-2 overflow-x-auto" role="group" aria-label={strings.entry.suggestions}>
          {suggestions.map((d) => (
            <Chip key={d} onSelectedChange={() => { describe(d); }} className="shrink-0">{d}</Chip>
          ))}
        </div>
      </div>

      <Group label={strings.entry.category}>
        <div className="flex flex-wrap gap-x-2 gap-y-3" role="group" aria-label={strings.entry.category}>
          {live.map((c) => (
            <Chip
              key={c.id}
              colour={categoryColour(c.colour)}
              {...(isPlaceholderEmoji(c.emoji) ? {} : { icon: <span className="leading-none">{c.emoji}</span> })}
              selected={s.categoryId === c.id}
              suggested={guess.categoryId === c.id}
              suggestible
              onSelectedChange={() => {
                picked.current.category = true;
                update({ ...s, categoryId: c.id, categoryTouched: true });
              }}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </Group>

      {pair.length === 2 ? (
        <>
          <Group label={isBack ? strings.entry.whoGotIt : strings.entry.whoPaid} id={`${formId}-payer`}>
            <PayerToggle
              label={isBack ? strings.entry.whoGotIt : strings.entry.whoPaid}
              people={pair}
              value={s.payer}
              onChange={(payer) => {
                // The split stays each person's own percentage; only its wording follows the payer.
                update({ ...s, payer });
              }}
            />
          </Group>

          <Group label={strings.entry.split}>
            <Segmented
              label={strings.entry.split}
              options={splitOptions}
              value={s.splitMode}
              onValueChange={(mode) => {
                picked.current.split = true;
                update({ ...s, splitMode: mode, splitTouched: true });
              }}
            />
            {s.splitMode === 'ratio' && other ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label={strings.entry.ratioPresets}>
                  {RATIO_PRESETS.map((p) => (
                    <Chip
                      key={p}
                      selected={payerPct === p}
                      onSelectedChange={() => {
                        picked.current.split = true;
                        update(setPayerShare(s, p, pair));
                      }}
                    >
                      <span className="nums-list">{strings.reading.ratio(p, 100 - p)}</span>
                    </Chip>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={payerPct}
                  aria-label={strings.entry.percent(payerPerson.name)}
                  aria-valuetext={strings.entry.ratioLine(payerPerson.name, payerPct, other.name, 100 - payerPct)}
                  onChange={(e) => {
                    picked.current.split = true;
                    update(setPayerShare(s, Number(e.target.value), pair));
                  }}
                  className="accent-forest h-11 w-full"
                />
                <p className="text-secondary text-ink-2 nums-list m-0">{strings.entry.ratioLine(payerPerson.name, payerPct, other.name, 100 - payerPct)}</p>
              </div>
            ) : null}
            {s.splitMode === 'exact' ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  {pair.map((p) => (
                    <Field
                      key={p.id}
                      label={strings.entry.share(p.name)}
                      inputMode="decimal"
                      enterKeyHint="next"
                      autoComplete="off"
                      value={s.exactText[p.id] ?? ''}
                      onKeyDown={holdEnterWhileComposing}
                      onChange={(e) => { update({ ...s, exactText: { ...s.exactText, [p.id]: e.target.value } }); }}
                    />
                  ))}
                </div>
                <p className="text-secondary text-ink-2 nums-list m-0 min-h-[1.3rem]" aria-live="polite">{remainder}</p>
              </div>
            ) : null}
          </Group>
        </>
      ) : null}

      <Group label={strings.entry.date}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={strings.entry.date}>
          <Chip selected={!picking && s.date === today} onSelectedChange={() => { setPicking(false); update({ ...s, date: today }); }}>
            {strings.entry.today}
          </Chip>
          <Chip selected={!picking && s.date === yesterdayOf(today)} onSelectedChange={() => { setPicking(false); update({ ...s, date: yesterdayOf(today) }); }}>
            {strings.entry.yesterday}
          </Chip>
          <Chip selected={picking} onSelectedChange={() => { setPicking(true); }}>
            {picking && s.date !== today && s.date !== yesterdayOf(today) ? formatDay(s.date, today) : strings.entry.pickDate}
          </Chip>
        </div>
        {picking ? (
          <input
            type="date"
            aria-label={strings.entry.dateField}
            value={s.date}
            max={today}
            onChange={(e) => { if (e.target.value) update({ ...s, date: e.target.value }); }}
            className="bg-sunk text-ink mt-3 min-h-12 w-full rounded-[12px] px-4"
          />
        ) : null}
      </Group>

      <div>
        <Button variant="plain" aria-expanded={showMore} onClick={() => { setShowMore(!showMore); }}>
          {strings.entry.more}
        </Button>
        {showMore ? (
          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor={`${formId}-notes`} className="text-secondary text-ink-2 font-medium">{strings.entry.notes}</label>
            <textarea
              id={`${formId}-notes`}
              value={s.notes}
              rows={3}
              onChange={(e) => { update({ ...s, notes: e.target.value }); }}
              className="bg-sunk text-ink text-body min-h-24 w-full rounded-[12px] px-4 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </div>
        ) : null}
      </div>

    </form>
    </Sheet>
  );
}

/** The fields of an edit that differ from where the form started (the split when it was touched or differs). */
function changedFields(from: ExpenseDraft, to: ExpenseDraft, splitTouched: boolean): Partial<ExpenseDraft> {
  const out: Partial<ExpenseDraft> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (to.description !== from.description) out.description = to.description;
  if (to.amount !== from.amount) out.amount = to.amount;
  if (to.date !== from.date) out.date = to.date;
  if (to.categoryId !== from.categoryId) out.categoryId = to.categoryId;
  if (to.payer !== from.payer) out.payer = to.payer;
  if (splitTouched || !same(to.split, from.split)) out.split = to.split;
  if (!same(to.notes, from.notes)) out.notes = to.notes ?? null;
  if (!same(to.tags, from.tags)) out.tags = to.tags ?? [];
  return out;
}

/**
 * The database's default emoji (a plain dot) for a category nobody gave one: its colour dot shows instead,
 * so "Other" is never a tick beside a dot.
 */
function isPlaceholderEmoji(emoji: string): boolean {
  return emoji.trim() === '' || emoji.trim() === '•';
}

/** A field group with a small visible label (the controls name themselves for screen readers). */
function Group({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2" id={id}>
      <span aria-hidden="true" className="text-secondary text-ink-2 font-medium">{label}</span>
      {children}
    </div>
  );
}

/** Who paid: the two heads as a two-way choice (DESIGN §2.3: the chosen one perks its ears). */
function PayerToggle({ label, people, value, onChange }: { label: string; people: readonly Person[]; value: string; onChange: (id: string) => void }) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => { if (v) onChange(v); }}
      className="flex gap-3"
    >
      {people.map((p) => (
        <ToggleGroup.Item
          key={p.id}
          value={p.id}
          className={cx(
            'text-body text-ink flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[12px] border-2 border-transparent bg-sunk px-3 py-2',
            'data-[state=on]:border-forest data-[state=on]:bg-surface data-[state=on]:text-forest',
          )}
        >
          <Head animal={p.animal} size={36} mood={value === p.id ? 'happy' : 'calm'} />
          <span className="min-w-0 truncate">{p.name}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/**
 * Add expense / Edit expense / Money back (DESIGN §4.2; ADD-3…ADD-7, SPL-1…SPL-5, MB-1, MB-2, CAT-3, CAT-4).
 * Amount first and largest with the numeric keypad open at once; description with earlier ones offered;
 * category chips with the household's guess marked; who paid as the two heads; the split; the date; notes
 * under More details. Save is instant and works offline; its toast offers Undo for 5 seconds.
 *
 * S2 polish wave 2: the amount is the hero (the display serif on a hairline, a sum's result inside the line,
 * Q-L12) and recent descriptions are offered before anything is typed; the split is one row of choices that
 * name each person's own share, "How it’s shared", with a 5 % stepper for Other (Q-U5); the date is the app's
 * own month grid in a small sheet (Q-L13); "More details" is a disclosure row (Q-L14); the toast says what was
 * saved, and Undo what was removed (Q-U8).
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Minus, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { formatDate, formatDay } from '../../core/dates';
import { formatPence } from '../../core/money';
import {
  addExpense, deleteExpense, editExpense, endRecurring, keepInboxItem, newId, pauseRecurring, rememberChoice, resumeRecurring, saveRecurring,
  useCategories, useCategoryMemory, useDataLayer, useEntries, useHousehold, useOnline, useRecurring, type ExpenseDraft, type ExpenseRow,
  type RecurringRow,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { enterMovesTo, enterSavesOnce } from '../../ui/keys';
import { Button, Chip, Choices, Disclosure, Field, Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { categoryColour } from '../../ui/tokens';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { isPlaceholderEmoji } from '../shared/CategoryMark';
import { Head } from '../shared/Head';
import { DateSheet } from '../shared/MonthGrid';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { defaultSplit, descriptionSuggestions, guessFor, otherCategoryId } from '../shared/suggest';
import type { Person } from '../shared/words';
import type { EntryRequest } from '../sheets';
import { RecurringHistory, Toggle } from './RecurringParts';
import { blankSchedule, everyOf, formFromTemplate, scheduleOf, type ScheduleState } from './schedule';
import {
  blankForm, draftOf, followExact, formFromRow, refundForm, remainderWords, setShareOf, SHEET_PRESETS, stepShare, sumWords, summaryWords,
  withExactText, withSplit, yesterdayOf, type FormState, type SplitChoice,
} from './form';

/**
 * A choice in "How it’s shared" (Q-U5): a preset as the first person's share, Other (the stepper), Exact, and
 * for an expense "For Sam" / "My treat"; for money back, whose money it all is ("All Jae’s").
 */
type SplitValue = `ratio:${string}` | 'other' | `all:${string}` | SplitChoice;

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
  const templates = useRecurring().data;
  const online = useOnline();
  // S3: the regular payment being edited (it stays the one opened, even as the list refreshes).
  const [template] = useState((): RecurringRow | undefined =>
    request.mode === 'recurring' && request.id !== undefined ? templates?.find((t) => t.id === request.id) : undefined);

  // The form starts once, from what was asked; later changes to the lists don't reset what is typed.
  const [initial] = useState((): FormState => {
    if (request.mode === 'edit' && existing) return formFromRow(existing, pair, request.input);
    if (request.mode === 'refund') return refundForm(request.of, pair, today);
    if (template) return formFromTemplate(template, pair, today);
    const split = defaultSplit({ remembered: null, category: undefined, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' });
    const blank = blankForm({ me: me?.id ?? '', people: pair, today, split });
    return { ...blank, categoryId: otherCategoryId(live), ...(request.mode === 'add' || request.mode === 'recurring' ? request.prefill : undefined) };
  });
  // S3 (REC-1): the schedule, when this is a regular payment ("Repeat" turns an expense into one).
  const [initialSchedule] = useState((): ScheduleState | null => {
    if (request.mode !== 'recurring') return null;
    if (template) return scheduleOf(template);
    return { ...blankSchedule(today), ...request.schedule };
  });
  const [rec, setRec] = useState<ScheduleState | null>(initialSchedule);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [s, setS] = useState<FormState>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(initial.notes !== '');
  const [pickingDate, setPickingDate] = useState(false);
  // Q-U5: "Other" stays chosen once picked, or when the split started off the chips, even when its stepper
  // passes a preset (otherwise the stepper vanishes under the finger and the next tap lands on the date).
  const [otherChosen, setOtherChosen] = useState(() => {
    const id = pair[0]?.id;
    return initial.splitMode === 'ratio' && id !== undefined && !(SHEET_PRESETS as readonly number[]).includes(initial.ratio[id] ?? 50);
  });
  // What the person chose themselves (taught to the app on Save, CAT-3, CAT-4).
  const picked = useRef({
    category: request.mode === 'add' && request.fromQuickAdd?.typedCategory === true,
    split: request.mode === 'add' && request.fromQuickAdd?.typedSplit === true,
  });

  const guess = useMemo(() => guessFor(s.description, { categories, memory, entries }), [s.description, categories, memory, entries]);
  const suggestions = useMemo(() => descriptionSuggestions(s.description, entries), [s.description, entries]);
  // The row is kept only when there is history to offer, so it is never an empty gap (Q-L12).
  const hasHistory = useMemo(() => entries.some((e) => e.deleted_at === null && e.kind === 'expense'), [entries]);

  // Q-F1: one row id for this form, and nothing after the first save (a double tap, Enter held).
  const [rowId] = useState(newId);
  const done = useRef(false);
  // Q-U1: Enter moves on through the form; only Enter in Description (or Save) saves.
  const descriptionRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const shareRefs = useRef<(HTMLInputElement | null)[]>([]);

  const update = (next: FormState) => {
    // Q-F5: money back on an exact split keeps the original's proportion until the person types a share.
    setS(followExact(next));
    setErrors([]);
  };
  /**
   * When closing asks "Discard your changes?" first. Editing a saved entry: any change from it (amount,
   * description, category, who paid, the split and its shares, the date, notes), since a tap outside would
   * otherwise drop it unseen. A new entry (add, money back): only typed text, as a tapped chip on an
   * otherwise empty form is one tap to redo (Q-U11).
   */
  const asked = (f: FormState, r: ScheduleState | null) => {
    const exact = f.splitMode === 'exact' ? f.exactText : null;
    return JSON.stringify(request.mode === 'edit' || template
      ? [f.amountText, f.description, f.categoryId, f.payer, f.splitMode, f.splitMode === 'ratio' ? f.ratio : null, exact, f.date, f.notes, r]
      : [f.amountText, f.description, f.notes, exact, r === null ? null : r.everyText]);
  };
  const dirty = asked(s, rec) !== asked(initial, initialSchedule);
  const changeSchedule = (next: Partial<ScheduleState>) => {
    if (rec) setRec({ ...rec, ...next });
    setErrors([]);
  };

  /** A new description: the category and split follow the household's guess until the person picks them. */
  const describe = (description: string) => {
    let next = { ...s, description };
    if (request.mode === 'add' || (request.mode === 'recurring' && !template)) {
      const g = guessFor(description, { categories, memory, entries });
      if (!s.categoryTouched) next = { ...next, categoryId: g.categoryId ?? otherCategoryId(live) };
      if (!s.splitTouched) {
        const category = live.find((c) => c.id === next.categoryId);
        next = withSplit(next, defaultSplit({ remembered: g.split, category, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' }), pair);
      }
    }
    update(next);
  };

  const title = rec ? (template ? strings.recurring.edit : strings.recurring.title)
    : request.mode === 'refund' ? strings.entry.moneyBack
    : request.mode === 'edit' ? (existing?.kind === 'money_back' ? strings.entry.editMoneyBack : strings.entry.edit)
    : strings.entry.add;
  if (!me) return null;
  const payerPerson = pair.find((p) => p.id === s.payer) ?? me;
  const other = pair.find((p) => p.id !== s.payer) ?? null;
  const isBack = s.kind === 'money_back';

  const save = (e?: SyntheticEvent) => {
    e?.preventDefault();
    if (done.current) return;
    if (rec) {
      saveSchedule(rec);
      return;
    }
    // Q-F2: a date after the phone's today is refused, as quick add refuses one (an edit keeps a date it had).
    // A bill kept from the Inbox keeps the bill's own day, set by the server's UK date, which can be "tomorrow" on a
    // phone behind the UK (abroad, or just before midnight).
    const fromInbox = request.mode === 'add' && request.inboxItem !== undefined && s.date === initial.date;
    if (s.date > today && !fromInbox && (request.mode !== 'edit' || s.date !== initial.date)) {
      setErrors([strings.entry.dateAfterToday]);
      return;
    }
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
      } else if (request.mode === 'add' && request.inboxItem !== undefined) {
        // INB-2 Keep: the bill becomes an entry with its template and occurrence, and leaves the Inbox.
        id = keepInboxItem(request.inboxItem, { ...draft, id: rowId });
        undo = () => { /* kept bills are edited or deleted from their entry page */ };
      } else {
        id = addExpense({ ...draft, id: rowId });
        // Q-U8: Undo says what it took away.
        undo = () => {
          if (deleteExpense(id)) toast.show({ message: strings.entry.removed(draft.description) });
        };
      }
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    done.current = true;
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
    // Q-U8: the toast says what happened, and keeps clear of the row it reports.
    toast.show({
      message: isBack ? strings.entry.moneyBackSaved : strings.entry.savedWhat(draft.description, formatPence(draft.amount)),
      icon: <Head animal={payerPerson.animal} size={24} nod />,
      action: { label: strings.entry.undo, onAction: undo },
      duration: 5000,
      about: id,
    });
    onDone();
  };

  /** S3 (REC-1, REC-6): saves the regular payment; an edit changes future occurrences only. */
  const saveSchedule = (r: ScheduleState) => {
    const every = everyOf(r.everyText);
    if (every === null) {
      setErrors([strings.recurring.everyNeeded]);
      return;
    }
    if (r.endDate !== null && r.endDate < r.startDate) {
      setErrors([strings.recurring.endBeforeStart]);
      return;
    }
    const description = s.description.trim() !== '' ? s.description : (live.find((c) => c.id === s.categoryId)?.name ?? '');
    const result = draftOf({ ...s, description, kind: 'expense' }, pair);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    const d = result.draft;
    try {
      saveRecurring({
        ...(template ? { id: template.id } : { id: rowId }),
        description: d.description, amount: d.amount, categoryId: d.categoryId, payer: d.payer, split: d.split, notes: d.notes ?? null,
        frequency: r.frequency, every, startDate: r.startDate, endDate: r.endDate, amountVaries: r.amountVaries, isSubscription: r.isSubscription,
      });
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    done.current = true;
    tickSaved();
    // OFF-4: one due today waits for the connection, and says so.
    const waits = !online && !template && r.startDate <= today && !r.amountVaries;
    toast.show({
      message: waits ? strings.bills.pendingPost(d.description) : strings.recurring.savedWhat(d.description),
      icon: <Head animal={payerPerson.animal} size={24} nod />,
      duration: waits ? 8000 : 5000,
    });
    onDone();
  };
  /** REC-1: pause, resume or end a template from its sheet; nothing is deleted. */
  const lifecycle = (what: 'pause' | 'resume' | 'end') => {
    if (!template || done.current) return;
    try {
      if (what === 'pause') pauseRecurring(template.id);
      else if (what === 'resume') resumeRecurring(template.id);
      else endRecurring(template.id);
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    done.current = true;
    const word = what === 'pause' ? strings.recurring.pausedToast : what === 'resume' ? strings.recurring.resumedToast : strings.recurring.endedToast;
    toast.show({ message: word(template.description) });
    onDone();
  };

  // Q-U5: one row of choices naming each person's own share, in the household's order (never the payer's).
  const [first, second] = pair;
  const firstPct = first ? (s.ratio[first.id] ?? 50) : 50;
  const named = (pct: number) => (first && second && pct !== 50 ? strings.reading.shares(first.name, pct, second.name, 100 - pct) : strings.reading.even);
  const isPreset = (SHEET_PRESETS as readonly number[]).includes(firstPct);
  const showOther = s.splitMode === 'ratio' && (otherChosen || !isPreset);
  const choice: SplitValue = s.splitMode === 'ratio'
    ? (showOther ? 'other' : `ratio:${String(firstPct)}`)
    : isBack && (s.splitMode === 'treat' || s.splitMode === 'for_other')
      ? `all:${s.splitMode === 'treat' ? s.payer : (other?.id ?? '')}`
      : s.splitMode;
  const splitOptions: { value: SplitValue; label: string }[] = [
    ...SHEET_PRESETS.map((p) => ({ value: `ratio:${String(p)}` as const, label: named(p) })),
    { value: 'other', label: strings.entry.other },
    { value: 'exact', label: strings.entry.exact },
    ...(isBack
      ? pair.map((p) => ({ value: `all:${p.id}` as const, label: strings.entry.allOf(p.name) }))
      : [
          { value: 'for_other' as const, label: strings.entry.forOther(other?.name ?? '') },
          { value: 'treat' as const, label: s.payer === me.id ? strings.entry.myTreat : strings.entry.theirTreat(payerPerson.name) },
        ]),
  ];
  const chooseSplit = (v: SplitValue) => {
    picked.current.split = true;
    setOtherChosen(v === 'other');
    if (v === 'other') update({ ...s, splitMode: 'ratio', splitTouched: true });
    else if (v.startsWith('ratio:')) update(first ? setShareOf(s, first.id, Number(v.slice('ratio:'.length)), pair) : s);
    else if (v.startsWith('all:')) update({ ...s, splitMode: v.slice('all:'.length) === s.payer ? 'treat' : 'for_other', splitTouched: true });
    else update({ ...s, splitMode: v as SplitChoice, splitTouched: true });
  };
  const step = (direction: 1 | -1) => {
    if (!first) return;
    picked.current.split = true;
    setOtherChosen(true);
    update(setShareOf(s, first.id, stepShare(firstPct, direction), pair));
  };

  const remainder = remainderWords(s, pair);
  const summary = summaryWords(s, pair);
  const sum = sumWords(s);
  const yesterday = yesterdayOf(today);
  const otherDay = s.date !== today && s.date !== yesterday;

  const footer = (
    <div className="flex flex-col gap-2">
      <p className="text-secondary text-ink-2 nums-list m-0 min-h-[1.4rem] truncate">{summary}</p>
      {errors.length > 0 ? <p role="alert" className="text-secondary text-berry m-0">{errors.join(' ')}</p> : null}
      <Button ref={saveRef} type="submit" form={formId} block>{strings.entry.save}</Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onDone(); }} title={title} dirty={dirty} full footer={footer}>
    <form id={formId} onSubmit={save} noValidate className="flex flex-col gap-5">
      {/* Q-L12: the hero. The display serif on a hairline, a ghost "0.00", and a sum's result inside the line. */}
      <Field
        label={strings.entry.amount}
        variant="amount"
        value={s.amountText}
        placeholder={strings.entry.amountPlaceholder}
        trailing={sum}
        onChange={(e) => { update({ ...s, amountText: e.target.value }); }}
        onKeyDown={(e) => { enterMovesTo(e, descriptionRef.current); }}
        enterKeyHint="next"
        autoFocus={request.mode !== 'edit'}
      />

      <div className="flex flex-col gap-2">
        <Field
          ref={descriptionRef}
          label={strings.entry.description}
          value={s.description}
          placeholder={strings.entry.descriptionPlaceholder}
          onChange={(e) => { describe(e.target.value); }}
          onKeyDown={enterSavesOnce}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        {/* A fixed-height row, so suggestions appearing never push the form down; recent ones before typing. */}
        {hasHistory ? (
          <div className="-mx-1 flex h-11 min-w-0 items-center gap-2 overflow-x-auto px-1" role="group" aria-label={strings.entry.suggestions}>
            {suggestions.map((d) => (
              <Chip key={d} onSelectedChange={() => { describe(d); }} className="shrink-0">{d}</Chip>
            ))}
          </div>
        ) : null}
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
                // A split is each person's own share; only its wording follows the payer. Money back that is
                // all one person's stays that person's (Q-U5: the meaning never flips).
                if (isBack && (s.splitMode === 'treat' || s.splitMode === 'for_other')) {
                  const holder = s.splitMode === 'treat' ? s.payer : other?.id;
                  update({ ...s, payer, splitMode: holder === payer ? 'treat' : 'for_other' });
                } else update({ ...s, payer });
              }}
            />
          </Group>

          <Group label={strings.entry.shared}>
            <Choices label={strings.entry.shared} options={splitOptions} value={choice} onValueChange={chooseSplit} />
            {showOther && first && second ? (
              <div className="mt-3 flex min-w-0 items-center gap-3">
                <StepButton label={strings.entry.lessFor(first.name)} disabled={firstPct <= 0} onClick={() => { step(-1); }}>
                  <Minus size={20} strokeWidth={2} aria-hidden="true" />
                </StepButton>
                <p aria-live="polite" className="text-body nums-list m-0 min-w-0 flex-1 text-center">{strings.reading.shares(first.name, firstPct, second.name, 100 - firstPct)}</p>
                <StepButton label={strings.entry.moreFor(first.name)} disabled={firstPct >= 100} onClick={() => { step(1); }}>
                  <Plus size={20} strokeWidth={2} aria-hidden="true" />
                </StepButton>
              </div>
            ) : null}
            {s.splitMode === 'exact' ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  {pair.map((p, i) => (
                    <Field
                      key={p.id}
                      ref={(el) => { shareRefs.current[i] = el; }}
                      label={strings.entry.share(p.name)}
                      inputMode="decimal"
                      enterKeyHint="next"
                      autoComplete="off"
                      value={s.exactText[p.id] ?? ''}
                      // Q-U1: Enter goes to the next share; on the last one, to Save (it saves nothing itself).
                      onKeyDown={(e) => { enterMovesTo(e, i + 1 < pair.length ? shareRefs.current[i + 1] : saveRef.current); }}
                      onChange={(e) => { update(withExactText(s, p.id, e.target.value)); }}
                    />
                  ))}
                </div>
                <p className="text-secondary text-ink-2 nums-list m-0 min-h-[1.3rem]" aria-live="polite">{remainder}</p>
              </div>
            ) : null}
          </Group>
        </>
      ) : null}

      {rec ? (
        <ScheduleFields
          rec={rec}
          today={today}
          startLocked={template !== undefined && template.posted_count > 0}
          onChange={changeSchedule}
          onPick={setPicking}
        />
      ) : (
      <Group label={strings.entry.date}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={strings.entry.date}>
          <Chip selected={s.date === today} onSelectedChange={() => { update({ ...s, date: today }); }}>
            {strings.entry.today}
          </Chip>
          <Chip selected={s.date === yesterday} onSelectedChange={() => { update({ ...s, date: yesterday }); }}>
            {strings.entry.yesterday}
          </Chip>
          {/* Q-L13: the app's own month grid, in a small sheet; the chip then reads the day ("Tue 10 Nov"). */}
          <Chip selected={otherDay} aria-haspopup="dialog" onSelectedChange={() => { setPickingDate(true); }}>
            {otherDay ? formatDay(s.date, today) : strings.entry.pickDate}
          </Chip>
        </div>
      </Group>
      )}

      <Disclosure label={strings.entry.moreDetails} open={showMore} onOpenChange={setShowMore}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-notes`} className="text-secondary text-ink-2 font-medium">{strings.entry.notes}</label>
          <textarea
            id={`${formId}-notes`}
            value={s.notes}
            rows={3}
            onChange={(e) => { update({ ...s, notes: e.target.value }); }}
            className="bg-sunk text-ink text-body min-h-24 w-full resize-none rounded-[12px] px-4 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
        {/* REC-1: an expense can become a regular payment, keeping what was typed. */}
        {request.mode === 'add' && request.inboxItem === undefined && !rec && !isBack ? (
          <div className="mt-4">
            <Button variant="plain" onClick={() => { setRec(blankSchedule(s.date)); setErrors([]); }}>{strings.recurring.repeat}</Button>
          </div>
        ) : null}
      </Disclosure>
      {template ? (
        <div className="flex flex-col gap-4">
          {!template.active ? <p className="text-secondary text-ink-2 m-0">{strings.recurring.pausedNote}</p> : null}
          {template.end_date !== null && template.end_date <= today ? (
            <p className="text-secondary text-ink-2 m-0">{strings.recurring.endedNote(formatDay(template.end_date, today))}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {template.active
              ? <Button variant="plain" onClick={() => { lifecycle('pause'); }}>{strings.recurring.pause}</Button>
              : <Button variant="plain" onClick={() => { lifecycle('resume'); }}>{strings.recurring.resume}</Button>}
            {template.end_date === null || template.end_date > today
              ? <Button variant="plain" onClick={() => { lifecycle('end'); }}>{strings.recurring.end}</Button>
              : null}
          </div>
          <RecurringHistory template={template} />
        </div>
      ) : null}
    </form>
    <DateSheet
      open={pickingDate}
      onClose={() => { setPickingDate(false); }}
      value={s.date}
      today={today}
      onPick={(date) => { update({ ...s, date }); }}
    />
    {rec ? (
      <DateSheet
        open={picking !== null}
        onClose={() => { setPicking(null); }}
        value={picking === 'end' ? (rec.endDate ?? rec.startDate) : rec.startDate}
        today={today}
        max={null}
        title={picking === 'end' ? strings.recurring.pickEnd : strings.recurring.pickStart}
        onPick={(date) => { changeSchedule(picking === 'end' ? { endDate: date } : { startDate: date }); }}
      />
    ) : null}
    </Sheet>
  );
}

/** A −/+ for "Other" (Q-U5): a 44 px round target. */
function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="bg-sunk text-ink press inline-flex size-11 shrink-0 items-center justify-center rounded-full active:scale-[0.96] disabled:opacity-40"
    >
      {children}
    </button>
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

/** A field group with a small visible label (the controls name themselves for screen readers). */
function Group({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2" id={id}>
      <span aria-hidden="true" className="text-secondary text-ink-2 font-medium">{label}</span>
      {children}
    </div>
  );
}

/**
 * Who paid: the two heads as a two-way choice (DESIGN §2.3: the chosen one perks its ears). A choice card
 * (Q-L2): chosen is surface with a 1.5 px forest border; outlines only for keyboard focus.
 */
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
            'text-body text-ink press flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[12px] border-[1.5px] border-transparent bg-sunk px-3 py-2',
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

/**
 * S3 (REC-1): how often, every, starts (any day: the owner picks the day it recurs on), ends, and the two
 * switches. The start can't move once something has posted, so posted days never shift.
 */
function ScheduleFields({ rec, today, startLocked, onChange, onPick }: {
  rec: ScheduleState;
  today: string;
  startLocked: boolean;
  onChange: (next: Partial<ScheduleState>) => void;
  onPick: (which: 'start' | 'end') => void;
}) {
  const n = everyOf(rec.everyText) ?? 1;
  if (startLocked) {
    // Once one has posted, its days are fixed (DECISIONS: posted days never move); a new rhythm is a new payment.
    const often = rec.frequency === 'weekly' ? strings.recurring.weekly : rec.frequency === 'monthly' ? strings.recurring.monthly : strings.recurring.yearly;
    return (
      <>
        <Group label={strings.recurring.howOften}>
          <p className="text-body m-0">{strings.recurring.lockedRhythm(often, n, strings.recurring.unit(rec.frequency, n), formatDate(rec.startDate, today))}</p>
          <p className="text-secondary text-ink-2 m-0">{strings.recurring.lockedHint}</p>
        </Group>
        <EndsAndSwitches rec={rec} today={today} onChange={onChange} onPick={onPick} />
      </>
    );
  }
  return (
    <>
      <Group label={strings.recurring.howOften}>
        <Choices
          label={strings.recurring.howOften}
          options={[
            { value: 'weekly', label: strings.recurring.weekly },
            { value: 'monthly', label: strings.recurring.monthly },
            { value: 'yearly', label: strings.recurring.yearly },
          ]}
          value={rec.frequency}
          onValueChange={(frequency) => { onChange({ frequency }); }}
        />
        <div className="flex max-w-56 items-end gap-3">
          <Field
            label={strings.recurring.every}
            inputMode="numeric"
            autoComplete="off"
            value={rec.everyText}
            onChange={(e) => { onChange({ everyText: e.target.value }); }}
            className="w-20"
          />
          <span className="text-body text-ink-2 pb-3">{strings.recurring.unit(rec.frequency, n)}</span>
        </div>
      </Group>

      <Group label={strings.recurring.starts}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={strings.recurring.starts}>
          <Chip selected={rec.startDate === today} onSelectedChange={() => { onChange({ startDate: today }); }}>
            {strings.entry.today}
          </Chip>
          <Chip selected={rec.startDate !== today} aria-haspopup="dialog" onSelectedChange={() => { onPick('start'); }}>
            {rec.startDate !== today ? formatDate(rec.startDate, today) : strings.entry.pickDate}
          </Chip>
        </div>
        <p className="text-secondary text-ink-2 m-0">{strings.recurring.startsHint}</p>
      </Group>
      <EndsAndSwitches rec={rec} today={today} onChange={onChange} onPick={onPick} />
    </>
  );
}

function EndsAndSwitches({ rec, today, onChange, onPick }: {
  rec: ScheduleState;
  today: string;
  onChange: (next: Partial<ScheduleState>) => void;
  onPick: (which: 'start' | 'end') => void;
}) {
  return (
    <>
      <Group label={strings.recurring.ends}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={strings.recurring.ends}>
          <Chip selected={rec.endDate === null} onSelectedChange={() => { onChange({ endDate: null }); }}>
            {strings.recurring.never}
          </Chip>
          <Chip selected={rec.endDate !== null} aria-haspopup="dialog" onSelectedChange={() => { onPick('end'); }}>
            {rec.endDate !== null ? formatDate(rec.endDate, today) : strings.entry.pickDate}
          </Chip>
        </div>
      </Group>

      <div className="flex flex-col">
        <Toggle label={strings.recurring.amountVaries} hint={strings.recurring.amountVariesHint} on={rec.amountVaries} onChange={(amountVaries) => { onChange({ amountVaries }); }} />
        <Toggle label={strings.recurring.subscription} on={rec.isSubscription} onChange={(isSubscription) => { onChange({ isSubscription }); }} />
      </div>
    </>
  );
}

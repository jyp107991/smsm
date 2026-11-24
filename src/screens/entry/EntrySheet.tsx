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
import { startTransition, useEffect, useId, useMemo, useRef, useState, type RefObject, type SyntheticEvent, type ReactNode } from 'react';
import { formatDate, formatDay, formatShortDate } from '../../core/dates';
import { isRunning, keepsAnchor, pastOccurrences } from '../../core/recurring';
import { currencyOf, currencySymbol } from '../../core/fx';
import type { ScanReply } from '../../core/aiReplies';
import { checkTotal, itemise } from '../../core/itemise';
import { splitForNewPayer } from '../../core/split';
import { formatPence, formatPlainPounds, pence, type Pence } from '../../core/money';
import {
  addExpense, deleteExpense, deleteRecurring, hasStarted, isDeleted, editExpense, endRecurring, restoreRecurring, keepImportNow, keepInboxItem, newId, undoKeep, pauseRecurring, rememberChoice, resumeRecurring, saveRecurring,
  currentCountry, currentOpenChapter, homeCountry, locate, guessCategory, keepPhoto, forgetPhoto, photoBlob, photoUrl, queuePhotoUpload, readReceipt, sortPhotoLater,
  useSmartFeatures, useCategories, useCategoryMemory, useChapters, useDataLayer, useEntries, useHousehold, useOnline, useRecurring, type ExpenseDraft, type ExpenseRow,
  type ChapterRow, type RecurringRow,
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
import { dayInSentence, type Person } from '../shared/words';
import type { EntryRequest } from '../sheets';
import { ChapterSheet, type ChapterEditing } from '../chapters/ChapterSheet';
import { ForeignAmount, PlaceRow } from '../places/EntryPlace';
import { Itemise, PhotoButton, ReceiptPhoto, type ReadingState } from './ReceiptParts';
import { RecurringHistory, Toggle } from './RecurringParts';
import { TagsField } from './TagsField';
import { blankSchedule, everyOf, formFromTemplate, restartLine, scheduleOf, type ScheduleState } from './schedule';
import {
  backSoFar, blankForm, draftOf, followExact, formFromRow, movesBalance, parsedAmount, refundForm, remainderWords, setShareOf, SHEET_PRESETS, stepShare, stillToComeBack, sumWords, summaryWords,
  withExactText, withSplit, yesterdayOf, type FormState, type SplitChoice,
} from './form';

/**
 * A choice in "How it’s shared" (Q-U5): a preset as the first person's share, Other (the stepper), Exact, and
 * for an expense "For Sam" / "My treat"; for money back, whose money it all is ("All Jae’s").
 */
type SplitValue = `ratio:${string}` | 'other' | `all:${string}` | SplitChoice;

/** A receipt's currency as an ISO code ("eur" → "EUR"), or null when it isn't one. */
function receiptCurrency(code: string | null): string | null {
  const c = code?.trim().toUpperCase() ?? '';
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** A receipt's amount in its own currency, as typed in the Amount box ("648", "12.50"). */
function foreignText(p: Pence): string {
  return formatPlainPounds(p).replace(/\.00$/, '');
}

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
  const chapters = useChapters().data;
  const online = useOnline();
  // S3: the regular payment being edited (it stays the one opened, even as the list refreshes).
  const [template] = useState((): RecurringRow | undefined =>
    request.mode === 'recurring' && request.id !== undefined ? templates?.find((t) => t.id === request.id) : undefined);

  // The form starts once, from what was asked; later changes to the lists don't reset what is typed.
  const [initial] = useState((): FormState => {
    if (request.mode === 'edit' && existing) return formFromRow(existing, pair, request.input);
    if (request.mode === 'refund') return refundForm(request.of, pair, today, entries);
    if (template) return formFromTemplate(template, pair, today);
    const split = defaultSplit({ remembered: null, category: undefined, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' });
    const blank = blankForm({ me: me?.id ?? '', people: pair, today, split });
    // CHP-2: a new entry starts in this phone's current chapter (an Inbox bill never does, REC-4).
    const chapterId = request.mode === 'add' && request.inboxItem === undefined ? currentOpenChapter() : null;
    // PLC-3: and this phone's current country.
    const country = currentCountry();
    return { ...blank, categoryId: otherCategoryId(live), chapterId, country, ...(request.mode === 'add' || request.mode === 'recurring' ? request.prefill : undefined) };
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
  // CHP-1: a chapter started from this form is chosen for this entry (one request object per opening).
  const [newChapter, setNewChapter] = useState(false);
  // PLC-2: with location on, a new entry dated today picks up the town and country when the sheet opens (never
  // blocks saving; a place typed or removed meanwhile wins).
  const home = useHousehold().data?.home_country ?? homeCountry();
  const placeRef = useRef<HTMLInputElement>(null);
  const placeTouched = useRef(false);
  const capture = request.mode === 'add' && request.inboxItem === undefined && request.importCard === undefined && request.prefill?.place === undefined;
  useEffect(() => {
    if (!capture) return;
    let live = true;
    void locate().then((where) => {
      if (!live || !where || placeTouched.current) return;
      setS((prev) => {
        if (prev.date !== today) return prev;
        const country = where.country ?? prev.country;
        // Another currency now: "Paid in" starts again for it (never a stale conversion out of sight).
        const foreign = prev.foreign && currencyOf(country) !== prev.foreign.currency ? null : prev.foreign;
        return { ...prev, lat: where.lat, lng: where.lng, place: where.place ?? prev.place ?? null, country, foreign };
      });
    });
    return () => { live = false; };
  }, [capture, today]);
  const chapterEditing = useMemo<ChapterEditing>(
    () => (newChapter ? { mode: 'new', onSaved: (chapterId) => { setS((prev) => ({ ...prev, chapterId })); } } : null),
    [newChapter],
  );
  // S6a (SCAN-1…5): the receipt photo, its reading, and what the person has touched (a reading fills only the rest).
  const smart = useSmartFeatures();
  const photoMode = request.mode === 'add' && !rec;
  const fromInboxScan = request.mode === 'add' ? request.receiptPath : undefined;
  const [photo, setPhoto] = useState<{ path: string; url: string | null; queued: boolean } | null>(
    () => (fromInboxScan ? { path: fromInboxScan, url: null, queued: true } : null));
  const [reading, setReading] = useState<ReadingState>('idle');
  const [receipt, setReceipt] = useState<{ discount: Pence; service: Pence; tax: Pence; currency: string | null } | null>(null);
  const touched = useRef({ amount: false, description: false, date: false });
  const scanRun = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);
  // ADD-8: the "Scan receipt" shortcut with smart features off (or offline) offers "Add photo", under More details.
  const startScan = request.mode === 'add' && request.start === 'scan';
  const [showMore, setShowMore] = useState(initial.notes !== '' || (startScan && !(smart && online)));
  const [pickingDate, setPickingDate] = useState(false);
  // Q-U5: "Other" stays chosen once picked, or when the split started off the chips, even when its stepper
  // passes a preset (otherwise the stepper vanishes under the finger and the next tap lands on the date).
  // S9a (fix 8): who paid was changed in this sheet.
  const [payerMoved, setPayerMoved] = useState(false);
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
      ? [f.amountText, f.description, f.categoryId, f.payer, f.splitMode, f.splitMode === 'ratio' ? f.ratio : null, exact, f.date, f.notes, f.place ?? null, f.foreign ?? null, r]
      : [f.amountText, f.description, f.notes, exact, r === null ? null : r.everyText]);
  };
  const dirty = asked(s, rec) !== asked(initial, initialSchedule) || (photo !== null && fromInboxScan === undefined);
  const changeSchedule = (next: Partial<ScheduleState>) => {
    if (rec) setRec({ ...rec, ...next });
    setErrors([]);
  };

  // S9: a start in the past posts every occurrence since at once (post_due_recurring). The core counts them and what
  // they come to; the person chooses: add them (keep the start) or start from the next one. Asked for a new template,
  // or for an edit of a live one that hasn't posted yet when its schedule changes (the phone's posted_count can be out
  // of date, so an edit that keeps the schedule never asks); a paused one skips what fell due, a posted one can't move.
  const recEvery = rec ? everyOf(rec.everyText) : null;
  const scheduleChanged = template !== undefined && rec !== null
    && (rec.frequency !== template.frequency || recEvery !== template.every || rec.startDate !== template.start_date || rec.endDate !== template.end_date);
  const amountNow = parsedAmount(s);
  const pastSchedule = rec && recEvery !== null ? { frequency: rec.frequency, every: recEvery, startDate: rec.startDate, endDate: rec.endDate } : null;
  // S10 review 1: "has posted" is the server's ever_posted (a start moved into the future leaves posted_count at 0).
  const past = pastSchedule && (template === undefined || (template.active && !hasStarted(template) && scheduleChanged))
    ? pastOccurrences({ schedule: pastSchedule, amount: amountNow ?? pence(0) }, today)
    : null;
  // "Start from <next>" keeps the day only when the next date is on it; when it isn't (30 Nov from the 31st), online
  // the template is saved paused from the start picked, then resumed (the server skips the past, the 31st stays);
  // offline that skip would be counted whenever the writes arrive, so the start moves and the button says so.
  const nextKeepsDay = past?.nextDate != null && pastSchedule !== null && keepsAnchor(pastSchedule, past.nextDate);
  const skipKeepingDay = past?.nextDate != null && !nextKeepsDay && online;
  /** What the choice was made on: another start, rhythm, end, amount or "Amount varies" (or, for the skip, the connection) asks again. */
  const pastKey = rec ? [rec.frequency, recEvery, rec.startDate, rec.endDate, rec.amountVaries, amountNow, nextKeepsDay ? '' : online].join('|') : '';
  const [pastAnswer, setPastAnswer] = useState<{ key: string; choice: 'add' | 'skip' } | null>(null);
  const startsRef = useRef<HTMLDivElement>(null);
  const [focusStart, setFocusStart] = useState(0);
  useEffect(() => {
    if (focusStart === 0) return;
    // A frame later: the sheet's focus trap first moves focus off the button that just went away.
    const frame = requestAnimationFrame(() => { startsRef.current?.querySelectorAll<HTMLButtonElement>('button')[1]?.focus(); });
    return () => { cancelAnimationFrame(frame); };
  }, [focusStart]);
  const pastChoice: PastChoice | null = rec && past !== null && past.count > 0 ? (() => {
    const answer = pastAnswer?.key === pastKey ? pastAnswer.choice : null;
    const next = past.nextDate;
    const nextDay = next === null ? '' : dayInSentence(next, today);
    const amountLine = rec.amountVaries ? strings.recurring.pastBills(past.count)
      : strings.recurring.pastPayments(past.count, amountNow === null ? null : formatPence(past.totalPence));
    const repeatsOn = next === null || nextKeepsDay ? null
      : rec.frequency === 'monthly' ? strings.recurring.thenMonthly(Number(next.slice(8)))
        : strings.recurring.thenYearly(formatShortDate(next, `${next.slice(0, 4)}-01-01`));
    return {
      line: answer === 'skip' ? strings.recurring.pastSkipped(past.count, rec.amountVaries, nextDay) : amountLine,
      choice: answer,
      addLabel: strings.recurring.addPast(past.count),
      addedNote: strings.recurring.pastAdded(past.count),
      moveLabel: next === null ? null : strings.recurring.startFrom(nextDay, skipKeepingDay ? null : repeatsOn),
      moveIsChoice: skipKeepingDay,
      onAdd: () => { setPastAnswer({ key: pastKey, choice: 'add' }); setErrors([]); },
      onMove: () => {
        if (next === null) return;
        if (skipKeepingDay) {
          setPastAnswer({ key: pastKey, choice: 'skip' });
          setErrors([]);
          return;
        }
        changeSchedule({ startDate: next });
        // The choice it came from goes; focus moves to the start, now that day.
        setFocusStart((n) => n + 1);
      },
    };
  })() : null;

  // S10: Delete is for one that has stopped (paused, or ended on or before today); the database refuses the rest.
  const stopped = template !== undefined && !isRunning({ active: template.active, endDate: template.end_date }, today);
  // S10: a new start on one that has posted (the same rhythm): the core says what it does from now on.
  const restartText = template !== undefined && hasStarted(template) && rec !== null && recEvery !== null && rec.startDate !== template.start_date
    ? restartLine({ frequency: template.frequency as ScheduleState['frequency'], every: template.every, startDate: template.start_date, endDate: rec.endDate }, template.posted_count, rec.startDate, today)
    : null;
  // S10 review 4: deleted (on the other phone, say) while this sheet is open: it says so, and offers nothing to undo.
  const goneNow = template !== undefined && (templates ?? []).some((t) => t.id === template.id && isDeleted(t));

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

  // ───────── S6a: the receipt ─────────
  const pendingPhoto = useRef<Promise<string | null> | null>(null);
  /** SCAN-1: a reading fills only what the person hasn't touched since; lines that don't add up fill no amount. */
  const fill = (reply: ScanReply) => {
    const total = reply.total_pence === null ? null : pence(reply.total_pence);
    const items = reply.items.map((l) => ({ label: l.label, pence: pence(l.pence), shared: true }));
    const discount = pence(reply.discount_pence);
    const service = pence(reply.service_pence);
    const tax = pence(reply.tax_pence ?? 0);
    setReceipt({ discount, service, tax, currency: receiptCurrency(reply.currency) });
    setS((prev) => {
      const t = touched.current;
      let next: FormState = { ...prev, items: items.length > 0 ? items : null, billTotal: total };
      if (!t.description && reply.merchant) next = { ...next, description: reply.merchant };
      if (!t.date && reply.date) next = { ...next, date: reply.date };
      if (!prev.categoryTouched) {
        const named = reply.category === null ? undefined : live.find((c) => c.name === reply.category)?.id;
        const g = guessFor(next.description, { categories, memory, entries });
        next = { ...next, categoryId: named ?? g.categoryId ?? prev.categoryId };
        if (!prev.splitTouched) {
          const category = live.find((c) => c.id === next.categoryId);
          next = withSplit(next, defaultSplit({ remembered: g.split, category, householdRatio: household?.default_ratio, people: pair, me: me?.id ?? '' }), pair);
        }
      }
      if (!t.amount) {
        // PLC-6: a receipt in the currency of where this entry is turns on "Paid in", with the amount in that currency.
        // One in any other currency fills no amount: the person sets it (never pounds that are really euros).
        const code = receiptCurrency(reply.currency);
        const local = code !== null && code !== 'GBP' && currencyOf(next.country ?? home) === code ? code : null;
        const adds = items.length === 0 || (total !== null && checkTotal(items, discount, service, total, tax).adds);
        const usable = total !== null && adds && (code === null || code === 'GBP' || local !== null);
        if (local) next = { ...next, foreign: { currency: local, rateText: '' } };
        next = { ...next, amountText: usable ? (local ? foreignText(total) : formatPlainPounds(total)) : '' };
      }
      return followExact(next);
    });
    setErrors([]);
  };
  const scan = (blob: Blob) => {
    scanRun.current += 1;
    const run = scanRun.current;
    setReading('reading');
    void readReceipt(blob).then((r) => {
      if (run !== scanRun.current) return;
      if (r.ok) {
        fill(r.data);
        setReading('idle');
      } else setReading(r.reason === 'limit' ? 'limit' : r.reason === 'off' ? 'idle' : 'failed');
    });
  };
  /** SCAN-1: the photo is kept on this phone at once (shown straight away); read too when scanning. */
  const pick = (file: Blob, read: boolean) => {
    const url = URL.createObjectURL(file);
    setPhoto({ path: '', url, queued: false });
    const kept = keepPhoto(file).then(
      (path) => { setPhoto((p) => (p && p.url === url ? { ...p, path } : p)); return path; },
      (err: unknown) => { setPhoto(null); setErrors([err instanceof Error && err.name === 'PhotoUnreadableError' ? err.message : strings.errors.generic]); return null; },
    );
    pendingPhoto.current = kept;
    if (read) scan(file);
  };
  const removePhoto = () => {
    scanRun.current += 1;
    // Never saved with anything: it leaves this phone's store too (a receipt sorted earlier stays where it is).
    const was = pendingPhoto.current;
    if (photo && !photo.queued) void was?.then((path) => { if (path) forgetPhoto(path); });
    pendingPhoto.current = null;
    if (photo?.url?.startsWith('blob:')) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setReading('idle');
    // The receipt's lines and total go with it (what was filled in the visible fields stays, as the person sees it).
    setReceipt(null);
    setS((prev) => ({ ...prev, items: null, billTotal: null }));
  };
  // A photo picked into a form closed without saving is let go from this phone too.
  const photoNow = useRef(photo);
  useEffect(() => { photoNow.current = photo; }, [photo]);
  useEffect(() => () => {
    const p = photoNow.current;
    if (!done.current && p && !p.queued) void pendingPhoto.current?.then((path) => { if (path) forgetPhoto(path); });
  }, []);
  // The photo's preview address is let go when the sheet goes.
  const shownUrl = photo?.url ?? null;
  useEffect(() => () => { if (shownUrl?.startsWith('blob:')) URL.revokeObjectURL(shownUrl); }, [shownUrl]);
  /** SCAN-4: to the Inbox to sort later; nothing else is saved. */
  const sortLaterNow = (keptPath?: string) => {
    if (!photo || done.current) return;
    const path = keptPath ?? (photo.path === '' ? null : photo.path);
    if (path === null) {
      const waiting = pendingPhoto.current;
      void waiting?.then((p) => { if (p && pendingPhoto.current === waiting) sortLaterNow(p); });
      return;
    }
    try {
      sortPhotoLater(path);
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    done.current = true;
    toast.show({ message: strings.smart.sortedLater });
    onDone();
  };
  // ADD-8: a photo shared into the app is attached at once, and read as a scan when it can be.
  const sharedPhoto = request.mode === 'add' ? request.shared?.photo : undefined;
  useEffect(() => {
    // Just after the sheet's first render (never a render cascade inside it).
    if (sharedPhoto) void Promise.resolve().then(() => { pick(sharedPhoto, smart && online); });
    // Once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // SCAN-4: a receipt sorted later shows its photo, and is read now if it can be.
  useEffect(() => {
    if (!fromInboxScan) return;
    let live = true;
    void photoUrl(fromInboxScan).then((url) => { if (live && url) setPhoto((p) => (p ? { ...p, url } : p)); });
    if (smart && online) void photoBlob(fromInboxScan).then((blob) => { if (live && blob) scan(blob); });
    return () => { live = false; };
    // Once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** SCAN-2: ticking a line shares it; the amount follows while the lines add up and the person hasn't typed one. */
  const toggleItem = (index: number) => {
    setS((prev) => {
      const items = prev.items?.map((l, i) => (i === index ? { ...l, shared: !l.shared } : l)) ?? null;
      let next: FormState = { ...prev, items };
      if (items && receipt && prev.billTotal != null && !touched.current.amount && checkTotal(items, receipt.discount, receipt.service, prev.billTotal, receipt.tax).adds) {
        const { amount } = itemise(items, items.map((l) => l.shared), receipt.discount, receipt.service, receipt.tax);
        next = { ...next, amountText: prev.foreign ? foreignText(amount) : formatPlainPounds(amount) };
      }
      return followExact(next);
    });
    setErrors([]);
  };
  const mismatch = s.items && s.items.length > 0 && receipt && s.billTotal != null && !checkTotal(s.items, receipt.discount, receipt.service, s.billTotal, receipt.tax).adds
    ? { lines: checkTotal(s.items, receipt.discount, receipt.service, s.billTotal, receipt.tax).lines, total: s.billTotal } : null;

  const title = rec ? (template ? strings.recurring.edit : strings.recurring.title)
    : request.mode === 'refund' ? strings.entry.moneyBack
    : request.mode === 'edit' ? (existing?.kind === 'money_back' ? strings.entry.editMoneyBack : strings.entry.edit)
    : strings.entry.add;
  if (!me) return null;
  const payerPerson = pair.find((p) => p.id === s.payer) ?? me;
  const other = pair.find((p) => p.id !== s.payer) ?? null;
  const isBack = s.kind === 'money_back';

  const save = (e?: SyntheticEvent, keptPath?: string) => {
    e?.preventDefault();
    if (done.current) return;
    // A photo still being kept on the phone (a moment at most): save once it is, with its path handed over (never
    // by reading this render's state again, which still has no path).
    const photoPath = keptPath ?? (photo?.path === '' ? null : (photo?.path ?? null));
    if (photo && photoPath === null) {
      const waiting = pendingPhoto.current;
      void waiting?.then((path) => { if (path && pendingPhoto.current === waiting) save(undefined, path); });
      return;
    }
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
    const result = draftOf({ ...s, description, ...(photoMode ? { receiptPath: photoPath } : {}) }, pair);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    const draft = result.draft;
    // MB-2 (S9a): never more back than the original still has to come back (the database refuses it too).
    const original = draft.kind === 'money_back' && draft.refundOf ? entries.find((x) => x.id === draft.refundOf) : undefined;
    // As the database: only a change that raises it is checked (an older refund can still be renamed).
    const raises = !(existing && existing.kind === 'money_back' && existing.deleted_at === null && existing.refund_of === draft.refundOf
      && draft.amount <= existing.amount_pence);
    // MB-3 (S9a review): money back is never for an original that was deleted (the database refuses it too).
    if (original && raises && original.deleted_at !== null) {
      setErrors([strings.invalid.originalDeleted]);
      return;
    }
    if (original && raises) {
      const left = stillToComeBack(original, entries, existing?.id);
      if (draft.amount > left) {
        setErrors([strings.entry.moreThanLeft(formatPence(left))]);
        return;
      }
    }
    // MB-2 (S9a review): an original is never edited below what has already come back on it (the database too).
    if (existing && existing.kind === 'expense' && draft.kind === 'expense' && draft.amount < existing.amount_pence) {
      const back = backSoFar(existing, entries);
      if (back > draft.amount) {
        setErrors([strings.entry.backMoreThanAmount(formatPence(back))]);
        return;
      }
    }
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
      } else if (request.mode === 'add' && request.importCard !== undefined) {
        // IMP-3 Change first: the bank row kept as changed here, still marked with its source and bank id.
        id = keepImportNow(request.importCard, { ...draft, id: rowId, always: request.importAlways ?? false });
        undo = () => {
          if (undoKeep(id)) toast.show({ message: strings.entry.removed(draft.description) });
        };
      } else if (request.mode === 'add' && request.inboxItem !== undefined) {
        // INB-2 Keep: the bill becomes an entry with its template and occurrence, and leaves the Inbox.
        id = keepInboxItem(request.inboxItem, { ...draft, id: rowId });
        undo = () => { /* kept bills are edited or deleted from their entry page */ };
      } else {
        // OFF-2: the photo's upload goes into the queue just ahead of its entry.
        if (photo && !photo.queued && photoPath !== null) queuePhotoUpload(photoPath);
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
    // CAT-2 step 4: nothing known about the words, so the AI may guess a moment later (marked as a guess).
    if (request.mode === 'add' && !isBack && !s.categoryTouched && !picked.current.category) void guessCategory(id);
    // Q-U8: the toast says what happened, and keeps clear of the row it reports.
    toast.show({
      message: isBack ? strings.entry.moneyBackSaved : strings.entry.savedWhat(draft.description, formatPence(draft.amount)),
      icon: <Head animal={payerPerson.animal} size={24} nod />,
      action: { label: strings.entry.undo, onAction: undo },
      duration: 5000,
      about: id,
    });
    // S9 (performance audit P4): the saved row and its toast are drawn first; the sheet starts sliding away
    // straight after, as its own (lower priority) step.
    startTransition(onDone);
  };

  /** S3 (REC-1, REC-6): saves the regular payment; an edit changes future occurrences only. */
  const saveSchedule = (r: ScheduleState) => {
    const every = everyOf(r.everyText);
    if (every === null) {
      setErrors([strings.recurring.everyNeeded]);
      return;
    }
    // An end before the start is refused when picked; one already stored (End tapped before it started) stays as it is.
    const keptEnd = template !== undefined && r.endDate === template.end_date && r.startDate === template.start_date;
    if (r.endDate !== null && r.endDate < r.startDate && !keptEnd) {
      setErrors([strings.recurring.endBeforeStart]);
      return;
    }
    const description = s.description.trim() !== '' ? s.description : (live.find((c) => c.id === s.categoryId)?.name ?? '');
    const result = draftOf({ ...s, description, kind: 'expense' }, pair);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    // S9: past payments are added only when the person has said so.
    if (pastChoice && pastChoice.choice === null) {
      setErrors([strings.recurring.pastFirst]);
      return;
    }
    const d = result.draft;
    // Start from the next one, keeping the day: saved paused, then resumed; the server skips what is past.
    const skipping = pastChoice?.choice === 'skip';
    try {
      if (skipping && template) pauseRecurring(template.id);
      const savedId = saveRecurring({
        ...(template ? { id: template.id } : { id: rowId }),
        description: d.description, amount: d.amount, categoryId: d.categoryId, payer: d.payer, split: d.split, notes: d.notes ?? null,
        frequency: r.frequency, every, startDate: r.startDate, endDate: r.endDate, amountVaries: r.amountVaries, isSubscription: r.isSubscription,
        ...(skipping && !template ? { active: false } : {}),
        // Review 2: only what this form changed of the schedule is sent (never the values it opened with).
        ...(template ? { opened: { frequency: template.frequency as ScheduleState['frequency'], every: template.every, startDate: template.start_date, endDate: template.end_date } } : {}),
      });
      if (skipping) resumeRecurring(savedId);
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
  /** REC-1: pause, resume or end a template from its sheet; S10: delete one that has stopped (soft, with Undo). */
  const lifecycle = (what: 'pause' | 'resume' | 'end' | 'delete') => {
    if (!template || done.current) return;
    let changed = true;
    try {
      if (what === 'pause') pauseRecurring(template.id);
      else if (what === 'resume') resumeRecurring(template.id);
      else if (what === 'end') endRecurring(template.id);
      else changed = deleteRecurring(template.id);
    } catch (err) {
      setErrors([plainError(err)]);
      return;
    }
    done.current = true;
    if (what === 'delete' && !changed) {
      // Review 4: already deleted (by the partner): nothing of ours to undo.
      toast.show({ message: strings.recurring.alreadyDeleted(template.description) });
    } else if (what === 'delete') {
      const { id, description } = template;
      toast.show({
        message: strings.recurring.deletedToast(description),
        action: { label: strings.entry.undo, onAction: () => { try { restoreRecurring(id); } catch (err) { toast.show({ message: plainError(err) }); } } },
        duration: 5000,
      });
    } else {
      const word = what === 'pause' ? strings.recurring.pausedToast : what === 'resume' ? strings.recurring.resumedToast : strings.recurring.endedToast;
      toast.show({ message: word(template.description) });
    }
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
  // S9a (fix 8): after a change of payer, a combination that doesn't move the balance says so.
  const noChange = (() => {
    if (isBack || movesBalance(s, pair) !== false) return null;
    return strings.entry.noBalanceChange(payerPerson.name);
  })();
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
        {...(s.foreign ? { symbol: currencySymbol(s.foreign.currency) } : {})}
        value={s.amountText}
        placeholder={strings.entry.amountPlaceholder}
        trailing={sum}
        onChange={(e) => { touched.current.amount = true; update({ ...s, amountText: e.target.value }); }}
        onKeyDown={(e) => { enterMovesTo(e, descriptionRef.current); }}
        enterKeyHint="next"
        autoFocus={request.mode !== 'edit'}
      />
      {!rec && !(request.mode === 'add' && request.inboxItem !== undefined && fromInboxScan === undefined) ? (
        <ForeignAmount s={s} home={home} setForm={(change) => { setS((prev) => followExact(change(prev))); setErrors([]); }} />
      ) : null}
      {photoMode && photo ? (
        <ReceiptPhoto
          url={photo.url}
          reading={reading}
          onRemove={removePhoto}
          onSortLater={request.inboxItem === undefined && request.importCard === undefined ? () => { sortLaterNow(); } : null}
        />
      ) : photoMode && smart && online ? (
        <div><PhotoButton label={strings.smart.scan} scan autoOpen={startScan} onPicked={(file) => { pick(file, true); }} /></div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Field
          ref={descriptionRef}
          label={strings.entry.description}
          value={s.description}
          placeholder={strings.entry.descriptionPlaceholder}
          onChange={(e) => { touched.current.description = true; describe(e.target.value); }}
          onKeyDown={enterSavesOnce}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        {/* A fixed-height row, so suggestions appearing never push the form down; recent ones before typing. */}
        {hasHistory ? (
          <div className="-mx-1 flex h-11 min-w-0 items-center gap-2 overflow-x-auto px-1" role="group" aria-label={strings.entry.suggestions}>
            {suggestions.map((d) => (
              <Chip key={d} onSelectedChange={() => { touched.current.description = true; describe(d); }} className="shrink-0">{d}</Chip>
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
                if (payer === s.payer) return;
                // A split is each person's own share; only its wording follows the payer (Q-U5, S9a fix 8: the
                // meaning never flips). "For Sam" that Sam now paid is Sam's own; a treat someone else paid is "for"
                // the one whose treat it was (core/split splitForNewPayer).
                setPayerMoved(true);
                if ((s.splitMode === 'treat' || s.splitMode === 'for_other') && first && second) {
                  const next = splitForNewPayer({ amount: parsedAmount(s) ?? pence(0), split: { mode: s.splitMode }, from: s.payer, to: payer, members: [first.id, second.id] });
                  update({ ...s, payer, splitMode: next.mode });
                } else update({ ...s, payer });
              }}
            />
            {payerMoved && noChange ? <p aria-live="polite" className="text-secondary text-ink-2 m-0 mt-2">{noChange}</p> : null}
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

      {/* REC-4: an Inbox bill or a posted regular payment is never in a chapter. */}
      {!rec && !(request.mode === 'add' && request.inboxItem !== undefined) && !existing?.recurring_id ? (
        <ChapterChoice
          chapters={chapters ?? []}
          value={s.chapterId ?? null}
          onChange={(chapterId) => { update({ ...s, chapterId }); }}
          onNew={() => { setNewChapter(true); }}
        />
      ) : null}

      {rec ? (
        <ScheduleFields
          rec={rec}
          today={today}
          rhythmLocked={template !== undefined && hasStarted(template)}
          restart={restartText}
          past={pastChoice}
          startsRef={startsRef}
          onChange={changeSchedule}
          onPick={setPicking}
        />
      ) : (
      <Group label={strings.entry.date}>
        <div className="flex flex-wrap gap-x-2 gap-y-3" role="group" aria-label={strings.entry.date}>
          <Chip selected={s.date === today} onSelectedChange={() => { touched.current.date = true; update({ ...s, date: today }); }}>
            {strings.entry.today}
          </Chip>
          <Chip selected={s.date === yesterday} onSelectedChange={() => { touched.current.date = true; update({ ...s, date: yesterday }); }}>
            {strings.entry.yesterday}
          </Chip>
          {/* Q-L13: the app's own month grid, in a small sheet; the chip then reads the day ("Tue 10 Nov"). */}
          <Chip selected={otherDay} aria-haspopup="dialog" onSelectedChange={() => { setPickingDate(true); }}>
            {otherDay ? formatDay(s.date, today) : strings.entry.pickDate}
          </Chip>
        </div>
      </Group>
      )}

      {!rec && s.place ? (
        <PlaceRow
          place={s.place}
          onEdit={() => { setShowMore(true); requestAnimationFrame(() => { placeRef.current?.focus(); }); }}
          onRemove={() => { placeTouched.current = true; update({ ...s, place: null, lat: null, lng: null }); }}
        />
      ) : null}

      <Disclosure label={strings.entry.moreDetails} open={showMore} onOpenChange={setShowMore}>
        {photoMode && !photo ? (
          <div className="mb-4"><PhotoButton label={strings.smart.addPhoto} scan={false} autoOpen={startScan && !(smart && online)} onPicked={(file) => { pick(file, false); }} /></div>
        ) : null}
        {photoMode && s.items && s.items.length > 0 ? <Itemise items={s.items} mismatch={mismatch} currency={receipt?.currency ?? null} onToggle={toggleItem} /> : null}
        {!rec ? (
          <Field
            ref={placeRef}
            label={strings.places.place}
            hint={strings.places.placeHint}
            value={s.place ?? ''}
            autoComplete="off"
            autoCapitalize="words"
            maxLength={80}
            className="mb-4"
            // A typed place carries no position (PLC-1).
            onChange={(e) => { placeTouched.current = true; update({ ...s, place: e.target.value, lat: null, lng: null }); }}
          />
        ) : null}
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
        {/* ADD-4: tags, as chips (quick add's #tags land here too). A regular payment keeps none of its own. */}
        {!rec ? (
          <div className="mt-4">
            <TagsField tags={s.tags} onChange={(tags) => { update({ ...s, tags }); }} />
          </div>
        ) : null}
        {/* CHP-1: with no chapter open yet, one can be started from here (it is chosen for this entry). */}
        {!rec && request.mode === 'add' && request.inboxItem === undefined && !(chapters ?? []).some((c) => !c.closed) ? (
          <div className="mt-4">
            <Button variant="plain" onClick={() => { setNewChapter(true); }}>{strings.chapters.start}</Button>
          </div>
        ) : null}
        {/* REC-1: an expense can become a regular payment, keeping what was typed. */}
        {request.mode === 'add' && request.inboxItem === undefined && request.importCard === undefined && !rec && !isBack ? (
          <div className="mt-4">
            <Button variant="plain" onClick={() => { setRec(blankSchedule(s.date)); setS((prev) => ({ ...prev, foreign: null })); setErrors([]); }}>{strings.recurring.repeat}</Button>
          </div>
        ) : null}
      </Disclosure>
      {template && goneNow ? (
        <div className="flex flex-col gap-4">
          <p className="text-secondary text-ink-2 m-0">{strings.recurring.deletedNote}</p>
          <RecurringHistory template={template} />
        </div>
      ) : template ? (
        <div className="flex flex-col gap-4">
          {!template.active ? <p className="text-secondary text-ink-2 m-0">{strings.recurring.pausedNote}</p> : null}
          {template.end_date !== null && template.end_date <= today ? (
            <p className="text-secondary text-ink-2 m-0">{strings.recurring.endedNote(dayInSentence(template.end_date, today))}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {template.active
              ? <Button variant="plain" onClick={() => { lifecycle('pause'); }}>{strings.recurring.pause}</Button>
              : <Button variant="plain" onClick={() => { lifecycle('resume'); }}>{strings.recurring.resume}</Button>}
            {template.end_date === null || template.end_date > today
              ? <Button variant="plain" onClick={() => { lifecycle('end'); }}>{strings.recurring.end}</Button>
              : null}
            {/* S10: Delete only once it has stopped (paused or ended), on its own line, as on an entry's page (Q-L11). */}
            {stopped ? (
              <div className="basis-full">
                <Button variant="destructive" leading onClick={() => { lifecycle('delete'); }}>{strings.recurring.delete}</Button>
              </div>
            ) : null}
          </div>
          {!stopped ? <p className="text-secondary text-ink-2 m-0">{strings.recurring.deleteFirst}</p> : null}
          <RecurringHistory template={template} />
        </div>
      ) : null}
    </form>
    <DateSheet
      open={pickingDate}
      onClose={() => { setPickingDate(false); }}
      value={s.date}
      today={today}
      onPick={(date) => { touched.current.date = true; update({ ...s, date }); }}
    />
    <ChapterSheet editing={chapterEditing} onClose={() => { setNewChapter(false); }} />
    {rec ? (
      <DateSheet
        open={picking !== null}
        onClose={() => { setPicking(null); }}
        // An end not picked yet starts from today (or the start, if that is later), not from a start long past.
        value={picking === 'end' ? (rec.endDate ?? (rec.startDate > today ? rec.startDate : today)) : rec.startDate}
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
  if (to.chapterId !== undefined && (to.chapterId ?? null) !== (from.chapterId ?? null)) out.chapterId = to.chapterId;
  // PLC-1, PLC-2, PLC-6: the country, the place (with its position) and the original currency, when changed.
  if (to.country !== undefined && to.country !== from.country) out.country = to.country;
  if (to.place !== undefined && (to.place ?? null) !== (from.place ?? null)) {
    out.place = to.place;
    out.lat = to.lat ?? null;
    out.lng = to.lng ?? null;
  }
  if (to.original !== undefined && !same(to.original, from.original)) out.original = to.original;
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
 * switches. S10: once something has posted, how often is fixed; the start can still move, and the line under it
 * (`restart`, the core's) says what that does: posted days never shift, nothing past posts.
 */
/** S9: what a start in the past adds, and the two ways on (worked out by the core, chosen by the person). */
interface PastChoice {
  line: string;
  /** What the person chose for this schedule, if anything. */
  choice: 'add' | 'skip' | null;
  addLabel: string;
  addedNote: string;
  moveLabel: string | null;
  /** The move is a choice made at Save (pressed), not a new start now. */
  moveIsChoice: boolean;
  onAdd: () => void;
  onMove: () => void;
}

function ScheduleFields({ rec, today, rhythmLocked, restart, past, startsRef, onChange, onPick }: {
  rec: ScheduleState;
  today: string;
  /** S10: one has posted, so how often is fixed (a new rhythm is a new payment); the start can still move. */
  rhythmLocked: boolean;
  /** S10: what a new start on one that has posted does, from the core (null when the start hasn't moved). */
  restart: string | null;
  past: PastChoice | null;
  startsRef: RefObject<HTMLDivElement | null>;
  onChange: (next: Partial<ScheduleState>) => void;
  onPick: (which: 'start' | 'end') => void;
}) {
  const n = everyOf(rec.everyText) ?? 1;
  const often = rec.frequency === 'weekly' ? strings.recurring.weekly : rec.frequency === 'monthly' ? strings.recurring.monthly : strings.recurring.yearly;
  return (
    <>
      {rhythmLocked ? (
        <Group label={strings.recurring.howOften}>
          <div role="group" aria-label={strings.recurring.howOften} className="flex flex-col gap-1">
            <p className="text-body m-0">{strings.recurring.lockedOften(often, n, strings.recurring.unit(rec.frequency, n))}</p>
            <p className="text-secondary text-ink-2 m-0">{strings.recurring.lockedOftenHint}</p>
          </div>
        </Group>
      ) : (
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
      )}

      <Group label={strings.recurring.starts}>
        <div ref={startsRef} className="flex flex-col gap-3" role="group" aria-label={strings.recurring.starts}>
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            <Chip selected={rec.startDate === today} onSelectedChange={() => { onChange({ startDate: today }); }}>
              {strings.entry.today}
            </Chip>
            <Chip selected={rec.startDate !== today} aria-haspopup="dialog" onSelectedChange={() => { onPick('start'); }}>
              {rec.startDate !== today ? formatDate(rec.startDate, today) : strings.entry.pickDate}
            </Chip>
          </div>
          {/* Read out as it appears or changes (a new start, amount or rhythm). Always in the page (never display:none,
              which some screen readers don't announce from); empty, it takes no room (the gap above is taken back). */}
          <div aria-live="polite" className="flex flex-col gap-2 empty:-mt-3">
            {restart !== null ? <p className="text-body text-ink nums-list m-0 break-words">{restart}</p> : null}
            {past ? <p className="text-body text-ink nums-list m-0 break-words">{past.line}</p> : null}
            {past?.choice === 'add' ? <p className="text-secondary text-ink-2 m-0">{past.addedNote}</p> : null}
          </div>
          {past ? (
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              <Button variant="plain" aria-pressed={past.choice === 'add'} onClick={past.onAdd}>{past.addLabel}</Button>
              {past.moveLabel !== null ? (
                <Button variant="plain" {...(past.moveIsChoice ? { 'aria-pressed': past.choice === 'skip' } : {})} onClick={past.onMove}>{past.moveLabel}</Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* S10: a moved start's own line says when it posts; the general hint would repeat it. */}
        {restart === null ? <p className="text-secondary text-ink-2 m-0">{strings.recurring.startsHint}</p> : null}
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
        <div className="flex flex-wrap gap-x-2 gap-y-3" role="group" aria-label={strings.recurring.ends}>
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

/**
 * CHP-2: which chapter the entry is in: Everyday or an open chapter (and the entry's own, even if closed). Shown
 * only when there is a chapter to choose; the current one is chosen for a new entry.
 */
function ChapterChoice({ chapters, value, onChange, onNew }: {
  chapters: readonly ChapterRow[]; value: string | null; onChange: (id: string | null) => void; onNew: () => void;
}) {
  const options = chapters.filter((c) => !c.closed || c.id === value);
  if (options.length === 0) return null;
  return (
    <Group label={strings.chapters.chapter}>
      <div className="flex flex-wrap gap-x-2 gap-y-3" role="group" aria-label={strings.chapters.chapter}>
        <Chip selected={value === null} onSelectedChange={() => { onChange(null); }}>{strings.chapters.everyday}</Chip>
        {options.map((c) => (
          <Chip
            key={c.id}
            selected={value === c.id}
            {...(c.emoji ? { icon: <span className="leading-none">{c.emoji}</span> } : {})}
            onSelectedChange={() => { onChange(c.id); }}
          >
            {c.name}
          </Chip>
        ))}
        <Chip aria-haspopup="dialog" onSelectedChange={onNew}>{strings.chapters.newChip}</Chip>
      </div>
    </Group>
  );
}

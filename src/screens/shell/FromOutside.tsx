/**
 * Opened from outside the app (S6b; ADD-8, NOT-3): the app-icon shortcuts (`/?do=add`, `/?do=scan`, `/?do=settle`)
 * and Android's share sheet (`/?do=shared`, after the service worker kept what was shared). Each opens its sheet once
 * and the parameter leaves the address, so going back or reloading opens nothing. Nothing saves until Save.
 */
import { useEffect, useRef } from 'react';
import { formatPlainPounds } from '../../core/money';
import { parseLoose, takeShared, useCategories, useCategoryMemory, useDataLayer, useEntries, useHousehold, useOnline, useSmartFeatures } from '../../data';
import { blankForm, withSplit } from '../entry/form';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { readQuickAdd } from '../shared/suggest';
import { useSheets } from '../sheets';

const ACTIONS = ['add', 'scan', 'settle', 'shared'] as const;
type Action = (typeof ACTIONS)[number];

/** The `do` asked for, taken out of the address at once (a reload or Back never opens it again). */
function takeAction(): Action | null {
  const params = new URLSearchParams(location.search);
  const asked = params.get('do');
  if (asked === null) return null;
  params.delete('do');
  const rest = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  return ACTIONS.find((a) => a === asked) ?? null;
}

/** Shared words with the amount at the end ("Dishoom 42.50") read as quick add reads them ("42.50 Dishoom"). */
function amountFirst(text: string): string {
  const m = /^(.*?)\s+(£?\d[\d,]*(?:\.\d{1,2})?)\s*$/u.exec(text.trim());
  return m?.[1] && m[2] ? `${m[2]} ${m[1]}` : text;
}

export function FromOutside() {
  const sheets = useSheets();
  const layer = useDataLayer();
  const people = usePeople();
  const loadedCategories = useCategories().data;
  const categories = loadedCategories ?? NO_CATEGORIES;
  const entries = useEntries().data ?? NO_ENTRIES;
  const memory = useCategoryMemory();
  const household = useHousehold().data ?? null;
  const smart = useSmartFeatures();
  const online = useOnline();
  const done = useRef(false);
  const me = people.me;
  // Only once the household's own settings are here (its usual split, its categories), so what opens is right.
  const ready = me !== null && household !== null && loadedCategories !== undefined;
  const ratio = household?.default_ratio;

  useEffect(() => {
    if (done.current || !ready) return;
    const person = me; // narrowed by ready, and kept for the callbacks below
    done.current = true;
    const action = takeAction();
    if (action === 'add') sheets.openEntry({ mode: 'add' });
    else if (action === 'scan') sheets.openEntry({ mode: 'add', start: 'scan' });
    else if (action === 'settle') sheets.openSettle({ mode: 'new' });
    else if (action === 'shared') {
      void takeShared(layer).then((shared) => {
        if (!shared) return;
        if (shared.photo) {
          sheets.openEntry({ mode: 'add', shared: { photo: shared.photo } });
          return;
        }
        const text = shared.text ?? '';
        const ctx = { today: layer.today(), me: person, partner: people.partner, categories, memory, entries, householdRatio: ratio };
        const reading = readQuickAdd(text, ctx) ?? readQuickAdd(amountFirst(text), ctx);
        if (reading) {
          const base = blankForm({ me: person.id, people: people.list, today: layer.today(), split: reading.split });
          sheets.openEntry({
            mode: 'add',
            prefill: withSplit({
              ...base, amountText: formatPlainPounds(reading.amount), description: reading.description, categoryId: reading.categoryId,
              categoryTouched: reading.typedCategory, payer: reading.payer, splitTouched: reading.typedSplit, date: reading.date, tags: reading.tags,
            }, reading.split, people.list),
          });
        } else if (smart && online) {
          // ADD-9: words the grammar can't read go to the AI, as in quick add; the words themselves if it can't either.
          void parseLoose(text).then((r) => {
            if (!r.ok || (r.data.amount === null && r.data.description === null)) {
              sheets.openEntry({ mode: 'add', prefill: { description: text.slice(0, 200) } });
              return;
            }
            const d = r.data;
            sheets.openEntry({
              mode: 'add',
              prefill: {
                ...(d.amount === null ? {} : { amountText: formatPlainPounds(d.amount) }), description: d.description ?? text.slice(0, 200),
                ...(d.categoryId ? { categoryId: d.categoryId, categoryTouched: true } : {}), ...(d.payer ? { payer: d.payer } : {}),
                ...(d.date ? { date: d.date } : {}), tags: d.tags,
              },
            });
          });
        } else {
          sheets.openEntry({ mode: 'add', prefill: { description: text.slice(0, 200) } });
        }
      });
    }
    // Once, when the app opens with a person signed in and the household's settings loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return null;
}

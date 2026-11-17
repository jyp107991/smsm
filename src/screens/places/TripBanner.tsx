/**
 * PLC-4 on Home: trips suggest themselves. Only with location on (permission already given; never asks here):
 * when the app opens or comes back, the phone checks where it is. Abroad with no open trip for that country:
 * "Looks like you're in Japan. Start a trip?" (Start a trip makes the trip chapter, current, and the country
 * current). Home again with this phone's current trip still open: "Welcome home. Close Japan? 9 days, £1,840.00."
 * "No" hides the trip question for that country until the phone has been home; "Not yet" hides welcome home today.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatPence } from '../../core/money';
import {
  closeChapter, homeCountry, locate, saveChapter, setCurrentChapter, setCurrentCountry, useChapters, useCurrentChapter, useDataLayer,
  useEntries, useLocationSetting,
} from '../../data';
import { Button } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { countryName, summaryOf } from '../chapters/model';
import { NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';

const SAID_NO = 'smsm-trip-no';
const NOT_YET = 'smsm-welcome-not-yet';

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function put(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* no storage: asked again next time */ }
}

export function TripBanner() {
  const layer = useDataLayer();
  const today = layer.today();
  const useLocation = useLocationSetting();
  const chapters = useChapters().data;
  const currentId = useCurrentChapter();
  const entries = useEntries().data ?? NO_ENTRIES;
  const people = usePeople();
  const [here, setHere] = useState<string | null>(null);
  // Bumped when a choice is stored, so the banner re-reads it.
  const [, setHidden] = useState(0);

  // Where the phone is: on open and each time the app comes back to the front.
  useEffect(() => {
    if (!useLocation) return;
    let live = true;
    const check = () => {
      void locate().then((where) => { if (live && where?.country) setHere(where.country); });
    };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [useLocation]);

  const home = homeCountry(layer);
  const current = chapters?.find((c) => c.id === currentId) ?? null;
  const ids = useMemo(() => people.list.map((p) => p.id), [people.list]);
  if (!useLocation || here === null || !chapters) return null;

  if (here !== home) {
    // Home was seen since the last "No": the question may come back.
    if (get(SAID_NO) === here) return null;
    if (chapters.some((c) => !c.closed && c.kind === 'trip' && c.country === here)) return null;
    const name = countryName(here) ?? here;
    return (
      <div role="note" className="bg-surface border-line flex flex-col gap-3 rounded-[16px] border px-4 py-3">
        <p className="m-0 break-words">{strings.places.tripAsk(name)}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="plain"
            onClick={() => {
              const id = saveChapter({ name, emoji: '🧳', kind: 'trip', country: here, startDate: today, endDate: null });
              setCurrentChapter(id);
              setCurrentCountry(here);
            }}
          >
            {strings.places.startTrip}
          </Button>
          <Button variant="plain" onClick={() => { put(SAID_NO, here); setHidden((n) => n + 1); }}>{strings.places.no}</Button>
        </div>
      </div>
    );
  }

  // Home: a "No" abroad is forgotten; offer to close this phone's current trip.
  if (get(SAID_NO) !== null) put(SAID_NO, null);
  if (!current || current.kind !== 'trip' || current.closed || get(NOT_YET) === `${current.id}:${today}`) return null;
  const s = summaryOf(current, entries, ids, today);
  return (
    <div role="note" className="bg-surface border-line flex flex-col gap-3 rounded-[16px] border px-4 py-3">
      <p className="m-0 break-words">{strings.places.welcomeHome(current.name, s.days, formatPence(s.total))}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="plain" onClick={() => { closeChapter(current.id); setCurrentCountry(null); }}>{strings.places.closeTrip(current.name)}</Button>
        <Button variant="plain" onClick={() => { put(NOT_YET, `${current.id}:${today}`); setHidden((n) => n + 1); }}>{strings.places.notYet}</Button>
      </div>
    </div>
  );
}

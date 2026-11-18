/**
 * Settings → Notifications (S8; NOT-1, OFF-4): this phone (allowed, turned off, blocked, can't), then one switch per
 * kind with its default, and the balance reminder's amount. The switches are the person's, for all their phones:
 * they are shown whatever this phone can do, change at once, and sync later when offline. Approvals always come
 * through and have no switch.
 */
import { useEffect, useState } from 'react';
import { formatPlainPounds, parseAmount, type Pence } from '../../core/money';
import {
  disablePush, enablePush, pushState, setNotificationPref, useDataLayer, useNotificationPrefs, useOnline,
  type PrefKey, type PushState,
} from '../../data';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, Field } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { Toggle } from '../entry/RecurringParts';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';

const t = strings.notifications;

export function NotificationsSection() {
  const layer = useDataLayer();
  const online = useOnline();
  const prefs = useNotificationPrefs();
  const partner = usePeople().partner?.name ?? null;
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void pushState().then((s) => { if (live) setState(s); }, () => { if (live) setState('off'); });
    return () => { live = false; };
  }, []);

  const run = async (what: () => Promise<PushState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await what());
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  const hint = (words: (name: string) => string) => (partner ? words(partner) : undefined);
  const switches: { key: PrefKey; label: string; hint: string | undefined }[] = [
    { key: 'entries', label: t.entries, hint: hint(t.entriesHint) },
    { key: 'settle_ups', label: t.settleUps, hint: hint(t.settleUpsHint) },
    { key: 'comments', label: t.comments, hint: hint(t.commentsHint) },
    { key: 'bills_today', label: t.billsToday, hint: t.billsTodayHint },
    { key: 'bills_tomorrow', label: t.billsTomorrow, hint: t.billsTomorrowHint },
    { key: 'recap', label: t.recap, hint: t.recapHint },
    { key: 'balance', label: t.balance, hint: t.balanceHint },
  ];

  return (
    <>
      {/* This phone: a line and a button, in a box of its own height so nothing below moves when the state is read. */}
      <div className="flex min-h-11 flex-col items-start gap-2">
        {state === 'unsupported' ? (
          <>
            <p className="m-0">{t.unsupported}</p>
            <p className="text-secondary text-ink-2 m-0">{t.unsupportedLine}</p>
          </>
        ) : state === 'blocked' ? (
          <p className="m-0">{t.blocked}</p>
        ) : state === 'on' ? (
          <>
            <p className="text-secondary text-ink-2 m-0">{t.onLine}</p>
            <Button variant="plain" loading={busy} onClick={() => void run(() => disablePush(layer))}>{t.turnOff}</Button>
          </>
        ) : state === 'off' ? (
          <Button variant="plain" loading={busy} disabled={!online} onClick={() => void run(() => enablePush(layer))}>{t.allow}</Button>
        ) : null}
        {!online && state !== 'unsupported' && state !== 'blocked' ? <p role="status" className="text-secondary text-ink-2 m-0">{t.offline}</p> : null}
        {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      </div>

      <div className="flex flex-col">
        {switches.map((s) => (
          <Toggle key={s.key} label={s.label} on={prefs[s.key]} onChange={(on) => { setNotificationPref(s.key, on, layer); }} {...(s.hint ? { hint: s.hint } : {})} />
        ))}
      </div>
      {prefs.balance ? <ReminderAmount pence={prefs.balance_threshold_pence} /> : null}
      <p className="text-secondary text-ink-2 m-0">{t.approvals}</p>
    </>
  );
}

/** "Remind me above": pounds and pence, saved when the field is left (or on Enter). */
function ReminderAmount({ pence }: { pence: Pence }) {
  const layer = useDataLayer();
  const shown = formatPlainPounds(pence);
  const [value, setValue] = useState(shown);
  const [last, setLast] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  if (shown !== last) {
    // Changed elsewhere (another phone): follow it unless something different is being typed.
    setLast(shown);
    if (value === last) setValue(shown);
  }
  const save = () => {
    const amount = parseAmount(value);
    if (amount === null) {
      setError(t.amountInvalid);
      return;
    }
    setError(null);
    setValue(formatPlainPounds(amount));
    if (amount !== pence) setNotificationPref('balance', amount, layer);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field
        variant="amount"
        label={t.remindAbove}
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onBlur={save}
        onKeyDown={holdEnterWhileComposing}
        enterKeyHint="done"
        {...(error ? { error } : {})}
      />
    </form>
  );
}

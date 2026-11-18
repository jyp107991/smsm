/**
 * Settings (SPEC 6.4 for S2; PPL-1, PPL-4, PPL-5, SET-2, EXP-1): the two of you, with Request a change and
 * any approval waiting; the usual split; your monzo.me name; the join code and Share invite until the
 * household is full; the theme; the version; Sign out (warning first if changes wait). S7: import from a bank
 * statement and its rules, export (entries CSV, monthly statement, Download a backup), restore, storage.
 */
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import {
  build, ChangesWaitingError, monzoNameOf, requestChange, setMonzoMe, signOut, useChangeRequests,
  setSmartFeatures, useHousehold, useSmartFeatures, useSyncStatus,
} from '../../data';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, Choices, Field, ICON, Segmented, Sheet, useToast } from '../../ui/primitives';
import { go } from '../../ui/router';
import { checkForUpdates } from '../../ui/updates';
import { strings } from '../../ui/strings';
import { setTheme, useTheme, type ThemeChoice } from '../../ui/theme';
import { AnimalPicker } from '../shared/AnimalPicker';
import { ApprovalBanners, MyRequests } from '../shared/Approvals';
import { Head } from '../shared/Head';
import { shareInvite } from '../shared/invite';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { ratioWords } from '../shared/words';
import { RATIO_PRESETS } from '../entry/form';
import { savePending } from '../settle/monzo';
import { Toggle } from '../entry/RecurringParts';
import { WhereYouAre } from '../places/WhereYouAre';
import { SettleDay } from './SettleDay';
import { ExportSection, RestoreSection, StorageSection } from './Export';
import { ImportRulesSection, ImportSection } from './Import';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-heading rule-ledger m-0">{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const people = usePeople();
  const household = useHousehold().data ?? null;
  const toast = useToast();
  const [requesting, setRequesting] = useState(false);
  const [splitSheet, setSplitSheet] = useState(false);
  const pending = (useChangeRequests().data ?? []).filter((r) => r.status === 'pending');
  const myPending = pending.some((r) => r.requested_by === people.me?.id && r.kind === 'identity');
  const splitPending = pending.some((r) => r.kind === 'default_ratio');
  const full = people.rows.length >= 2;
  const partner = people.partner;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-10 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center">
          <button
            type="button"
            onClick={() => { go({ name: 'home' }); }}
            className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
          >
            <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.settings.back}
          </button>
        </div>
        <h1 className="text-title m-0">{strings.settings.title}</h1>
      </header>

      <Section title={strings.settings.us}>
        <ApprovalBanners />
        <ul className="m-0 flex list-none flex-col p-0">
          {people.list.map((p) => (
            <li key={p.id} className="border-line flex min-h-16 items-center gap-3 border-b py-2 last:border-b-0">
              <Head animal={p.animal} size={40} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body break-words">{p.name}</span>
                <span className="text-secondary text-ink-2">{strings.settings.animalOf(p.animal)}</span>
              </span>
            </li>
          ))}
        </ul>
        <MyRequests />
        {!myPending ? (
          <div className="flex flex-col gap-2">
            <div>
              <Button variant="plain" disabled={!full} onClick={() => { setRequesting(true); }}>{strings.settings.requestChange}</Button>
            </div>
            {!full ? <p className="text-secondary text-ink-2 m-0">{strings.settings.needsPartner}</p> : null}
          </div>
        ) : null}
      </Section>

      <Section title={strings.settings.paying}>
        <MonzoName />
      </Section>

      {/* Q-U11: the usual split is how new entries are shared, not a way of paying: a section of its own. */}
      {full ? (
        <Section title={strings.settings.usualSplit}>
          <p className="m-0">
            {strings.settings.usualSplitLine(household?.default_ratio ? ratioWords(household.default_ratio, people.list) : strings.reading.even)}
          </p>
          {!splitPending ? (
            <div>
              <Button variant="plain" onClick={() => { setSplitSheet(true); }}>{strings.settings.changeSplit}</Button>
            </div>
          ) : null}
          <SettleDay />
        </Section>
      ) : null}

      {!full && household ? (
        <Section title={strings.settings.invite}>
          <p className="text-secondary text-ink-2 m-0">{strings.settings.inviteLine}</p>
          <p className="text-amount nums-list m-0 tracking-[0.2em]">{household.join_code}</p>
          <div>
            <Button
              variant="plain"
              onClick={() => { void shareInvite(household.join_code, () => { toast.show({ message: strings.settings.copied }); }); }}
            >
              {strings.settings.shareInvite}
            </Button>
          </div>
        </Section>
      ) : null}

      {/* CAT-1: the household's categories, edited on their own page. */}
      <Section title={strings.settings.spending}>
        <div className="flex flex-col">
          <a
            href="/settings/categories"
            onClick={(e) => { e.preventDefault(); go({ name: 'categories' }); }}
            className="text-ink text-body press flex min-h-12 items-center justify-between gap-3"
          >
            {strings.categories.link}
            <ChevronRight size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="text-ink-2" />
          </a>
          <p className="text-secondary text-ink-2 m-0">{strings.categories.linkLine}</p>
        </div>
        <div className="flex flex-col">
          <a
            href="/settings/chapters"
            onClick={(e) => { e.preventDefault(); go({ name: 'chapters' }); }}
            className="text-ink text-body press flex min-h-12 items-center justify-between gap-3"
          >
            {strings.chapters.link}
            <ChevronRight size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="text-ink-2" />
          </a>
          <p className="text-secondary text-ink-2 m-0">{strings.chapters.linkLine}</p>
        </div>
      </Section>

      {/* S7: bank statements in, entries out, backups back in, and what it all takes up (IMP-1, IMP-3, EXP-1, EXP-3). */}
      <Section title={strings.imports.section}>
        <ImportSection />
      </Section>
      <Section title={strings.imports.rulesSection}>
        <ImportRulesSection />
      </Section>
      <Section title={strings.exports.section}>
        <ExportSection />
      </Section>
      <Section title={strings.restore.section}>
        <RestoreSection />
      </Section>
      <Section title={strings.storage.section}>
        <StorageSection />
      </Section>

      <Section title={strings.places.whereYouAre}>
        <WhereYouAre />
      </Section>

      {/* S6a: one switch for the smart features, this phone only (off until turned on). */}
      <Section title={strings.smart.section}>
        <SmartSwitch />
      </Section>

      <Section title={strings.settings.look}>
        <ThemePicker />
      </Section>

      <Section title={strings.settings.about}>
        <p className="text-note m-0">{strings.app.tagline}</p>
        <SignOut />
        {/* Quiet: for the two of you to quote if something goes wrong, not to read (Q-L11). */}
        <p className="text-caption text-ink-2 nums-list m-0 mt-2" data-testid="version">{strings.app.version(build.version, build.commit)}</p>
        <CheckForUpdates />
      </Section>

      {partner ? <RequestSheet open={requesting} onClose={() => { setRequesting(false); }} /> : null}
      {partner ? <SplitSheet open={splitSheet} onClose={() => { setSplitSheet(false); }} /> : null}
    </div>
  );
}

/**
 * SET-2: the monzo.me name; saved on Enter or when the field is left. Q-U11: an "@name" is accepted, and a check
 * line says, as it is typed, where the partner will pay ("Sam will pay you at monzo.me/jaepark").
 */
function MonzoName() {
  const people = usePeople();
  const toast = useToast();
  const saved = people.myRow?.monzo_me ?? '';
  const [value, setValue] = useState(saved);
  const [state, setState] = useState<{ kind: 'idle' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    // It changed on the server (another phone): follow it unless something is being typed.
    setLastSaved(saved);
    if (value === lastSaved) setValue(saved);
  }
  const name = monzoNameOf(value);
  const save = async () => {
    if (name === (people.myRow?.monzo_me ?? '')) return;
    try {
      await setMonzoMe(name === '' ? null : value);
      setState({ kind: 'saved' });
      toast.show({ message: strings.settings.monzoSaved });
    } catch (err) {
      setState({ kind: 'error', message: plainError(err) });
    }
  };
  const partner = people.partner?.name;
  const hint = name === null || name === '' ? strings.settings.monzoHint(partner ?? '')
    : partner ? strings.settings.monzoCheck(partner, name) : strings.settings.monzoAddress(name);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Field
        label={strings.settings.monzo}
        value={value}
        onChange={(e) => { setValue(e.target.value); setState({ kind: 'idle' }); }}
        onBlur={() => void save()}
        onKeyDown={holdEnterWhileComposing}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        hint={hint}
        {...(state.kind === 'error' ? { error: state.message } : {})}
      />
    </form>
  );
}

function ThemePicker() {
  const theme = useTheme();
  const options: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: strings.settings.themeSystem },
    { value: 'light', label: strings.settings.themeLight },
    { value: 'dark', label: strings.settings.themeDark },
  ];
  return <Segmented label={strings.settings.theme} options={options} value={theme} onValueChange={setTheme} />;
}

function SignOut() {
  const { waiting, problems } = useSyncStatus();
  const [confirm, setConfirm] = useState(false);
  const [counts, setCounts] = useState({ waiting: 0, refused: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (discardWaiting: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await signOut({ discardWaiting });
      // A "Did it go through?" question belongs to the person who asked it, not the next one to sign in.
      void savePending(null);
      go({ name: 'home' }, { replace: true });
    } catch (err) {
      if (err instanceof ChangesWaitingError) {
        setCounts({ waiting: err.count - err.refused, refused: err.refused });
        setConfirm(true);
      }
      else setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="destructive" leading loading={busy && !confirm} onClick={() => {
            if (waiting > 0 || problems.length > 0) {
              setCounts({ waiting, refused: problems.length });
              setConfirm(true);
            } else void run(false);
          }}>
          {strings.settings.signOut}
        </Button>
      </div>
      {error ? <p className="text-secondary text-berry m-0" aria-live="polite">{error}</p> : null}
      <Sheet
        open={confirm}
        onOpenChange={(next) => { if (!next) setConfirm(false); }}
        title={strings.settings.signOutWaitingTitle}
        footer={
          <div className="flex flex-wrap gap-3">
            <Button variant="plain" className="flex-auto" onClick={() => { setConfirm(false); }}>{strings.settings.keepSignedIn}</Button>
            <Button variant="destructive" className="flex-auto" loading={busy} onClick={() => void run(true)}>{strings.settings.signOutAnyway}</Button>
          </div>
        }
      >
        {counts.waiting > 0 ? <p className="m-0">{strings.settings.signOutWaiting(counts.waiting)}</p> : null}
        {counts.refused > 0 ? <p className="mt-2 mb-0">{strings.settings.signOutRefused(counts.refused)}</p> : null}
        {error ? <p className="text-secondary text-berry mt-3 mb-0" aria-live="polite">{error}</p> : null}
      </Sheet>
    </div>
  );
}

/** PPL-4: ask the partner to approve a new name or animal. */
function RequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const people = usePeople();
  const me = people.me;
  const [name, setName] = useState(me?.name ?? '');
  const [animal, setAnimal] = useState<'cat' | 'dog'>(me?.animal ?? 'cat');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(me?.name ?? '');
      setAnimal(me?.animal ?? 'cat');
      setError(null);
    }
  }
  const send = async () => {
    if (!me) return;
    if (name.trim() === me.name && animal === me.animal) {
      setError(strings.settings.nothingChanged);
      return;
    }
    setBusy(true);
    try {
      await requestChange({ kind: 'identity', displayName: name, animal });
      toast.show({ message: strings.settings.requestSent });
      onClose();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={strings.settings.requestTitle}
      description={strings.settings.requestLine(people.partner?.name ?? '')}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button type="submit" form="request-form" block loading={busy}>{strings.settings.sendRequest}</Button>
        </div>
      }
    >
      <form id="request-form" onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-5">
        <Field label={strings.setup.name} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} onKeyDown={holdEnterWhileComposing} enterKeyHint="done" autoComplete="nickname" />
        <AnimalPicker value={animal} onChange={(a) => { setAnimal(a); setError(null); }} takenBy={null} />
      </form>
    </Sheet>
  );
}

/** PPL-5, SPL-2: ask the partner to approve a new usual split for new entries (named shares, Q-U5). */
function SplitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const people = usePeople();
  const [a, b] = people.list;
  /** The first person's share. */
  const [first, setFirst] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!a || !b || !people.me) return null;
  const me = people.me;
  const other = me.id === a.id ? b : a;
  const send = async () => {
    setBusy(true);
    try {
      await requestChange({ kind: 'default_ratio', ratio: { [a.id]: first, [b.id]: 100 - first } });
      toast.show({ message: strings.settings.requestSent });
      onClose();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={strings.settings.splitTitle}
      description={strings.settings.splitRequestLine(other.name)}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button block loading={busy} onClick={() => void send()}>{strings.settings.sendRequest}</Button>
        </div>
      }
    >
      <Choices
        label={strings.entry.shared}
        options={RATIO_PRESETS.map((p) => ({ value: String(p), label: p === 50 ? strings.reading.even : strings.reading.shares(a.name, p, b.name, 100 - p) }))}
        value={String(first)}
        onValueChange={(v) => { setFirst(Number(v)); }}
      />
    </Sheet>
  );
}

/** "Check for updates" (owner, 17 Nov): the launch check on demand, with a plain answer. */
function CheckForUpdates() {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const check = async () => {
    if (busy) return;
    setBusy(true);
    setAnswer(null);
    const result = await checkForUpdates();
    setBusy(false);
    // 'updated': the "Updating smsm" screen has taken over and the app restarts.
    if (result === 'latest') setAnswer(strings.update.latest);
    else if (result === 'skipped') setAnswer(strings.update.couldntCheck);
    else if (result === 'failed') setAnswer(strings.update.couldntUpdate);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="quiet" leading loading={busy} onClick={() => void check()}>
        {busy ? strings.update.checking : strings.update.check}
      </Button>
      <p role="status" aria-label={strings.update.checkStatus} className="text-caption text-ink-2 m-0 min-h-[1.25rem]">{answer ?? ''}</p>
    </div>
  );
}

function SmartSwitch() {
  const on = useSmartFeatures();
  return <Toggle label={strings.smart.switchLabel} hint={strings.smart.switchLine} on={on} onChange={setSmartFeatures} />;
}

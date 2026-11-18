/**
 * S7 (EXP-1, EXP-3, OFF-3): Settings → "Export" (the entries CSV for any range, the monthly statement, the JSON
 * backup), "Restore from a backup" and "Storage". The CSV and the backup are made on this phone, offline too; a
 * restore needs a connection and only ever adds.
 */
import { useEffect, useState } from 'react';
import { addMonths, formatDate, isIsoDate, startOfMonth } from '../../core/dates';
import {
  backupJson, build, defaultPeopleMap, RestoreRefusedError, exportEntriesCsv, FREE_DATABASE_BYTES, FREE_PHOTO_BYTES, lastStorageUsed, NEARLY_FULL, restoreBackup,
  restorePlan, storageUsed, useDataLayer, useHousehold, useOnline, type RestorePlan, type StorageFigure,
} from '../../data';
import { Button, Field, Sheet, useToast } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { fileText, FilePick, Select } from './Import';

/** Hands a file to the phone (the browser's download; the share sheet on a phone). */
export function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}

// ───────────────────────────── Export ─────────────────────────────

export function ExportSection() {
  const toast = useToast();
  const [csv, setCsv] = useState(false);
  const [month, setMonth] = useState(false);
  return (
    <>
      <p className="text-secondary text-ink-2 m-0">{strings.exports.sectionLine}</p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-start gap-1">
          <Button variant="plain" onClick={() => { setCsv(true); }}>{strings.exports.csv}</Button>
          <p className="text-secondary text-ink-2 m-0">{strings.exports.csvLine}</p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <Button variant="plain" onClick={() => { setMonth(true); }}>{strings.exports.statement}</Button>
          <p className="text-secondary text-ink-2 m-0">{strings.exports.statementLine}</p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="plain"
            onClick={() => {
              const json = backupJson({ appVersion: build.version });
              saveFile(`smsm-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }));
              toast.show({ message: strings.settings.backupDone });
            }}
          >
            {strings.settings.backup}
          </Button>
          <p className="text-secondary text-ink-2 m-0">{strings.settings.backupLine}</p>
        </div>
      </div>
      <CsvSheet open={csv} onClose={() => { setCsv(false); }} />
      <MonthSheet open={month} onClose={() => { setMonth(false); }} />
    </>
  );
}

function CsvSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const layer = useDataLayer();
  const today = layer.today();
  const toast = useToast();
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      // EXP-1: this month by default.
      setFrom(startOfMonth(today));
      setTo(today);
      setError(null);
    }
  }
  const download = () => {
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      setError(strings.exports.rangeBackwards);
      return;
    }
    try {
      const text = exportEntriesCsv({ from, to });
      saveFile(`smsm-entries-${from}-to-${to}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }));
      toast.show({ message: strings.exports.downloaded });
      onClose();
    } catch (err) {
      setError(plainError(err));
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={strings.exports.csv}
      description={strings.exports.csvLine}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button block onClick={download}>{strings.exports.download}</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
        <Field type="date" label={strings.exports.from} value={from} onChange={(e) => { setFrom(e.target.value); setError(null); }} />
        <Field type="date" label={strings.exports.to} value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} />
      </div>
    </Sheet>
  );
}

/** The months a statement can be made for: the current one and every finished one since the household began. */
function monthsSince(started: string | undefined, today: string): string[] {
  const first = started && isIsoDate(started.slice(0, 10)) ? started.slice(0, 7) : addMonths(startOfMonth(today), -23).slice(0, 7);
  const out: string[] = [];
  for (let m = startOfMonth(today); m.slice(0, 7) >= first && out.length < 240; m = addMonths(m, -1)) out.push(m.slice(0, 7));
  return out;
}

function MonthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const layer = useDataLayer();
  const today = layer.today();
  const household = useHousehold().data;
  const months = monthsSince(household?.created_at, today);
  const [month, setMonth] = useState(months[0] ?? today.slice(0, 7));
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={strings.exports.statement}
      description={strings.exports.statementLine}
      footer={
        <Button block onClick={() => { onClose(); go({ name: 'statement', month }); }}>{strings.exports.open}</Button>
      }
    >
      <Select label={strings.exports.month} value={month} onChange={setMonth}>
        {months.map((m) => <option key={m} value={m}>{strings.recap.monthName(m)}</option>)}
      </Select>
    </Sheet>
  );
}

// ───────────────────────────── Restore from a backup ─────────────────────────────

export function RestoreSection() {
  const layer = useDataLayer();
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = (file: File) => {
    setError(null);
    void fileText(file).then((text) => {
      const p = restorePlan(text, layer);
      if ('error' in p) setError(p.error === 'notTwo' ? strings.restore.notTwo : strings.restore.notBackup);
      else setPlan(p);
    }, () => { setError(strings.restore.notBackup); });
  };
  return (
    <>
      <p className="text-secondary text-ink-2 m-0">{strings.restore.sectionLine}</p>
      <FilePick label={strings.restore.choose} accept=".json,application/json" onPick={pick} />
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      <RestoreSheet plan={plan} onClose={() => { setPlan(null); }} />
    </>
  );
}

function RestoreSheet({ plan, onClose }: { plan: RestorePlan | null; onClose: () => void }) {
  const [shown, setShown] = useState<RestorePlan | null>(plan);
  if (plan !== null && plan !== shown) setShown(plan);
  return (
    <Sheet open={plan !== null} onOpenChange={(next) => { if (!next) onClose(); }} title={strings.restore.title}>
      {shown ? <RestoreForm key={shown.people.map((p) => p.id).join(':') + String(shown.rows.expenses.length)} plan={shown} onDone={onClose} /> : null}
    </Sheet>
  );
}

function RestoreForm({ plan, onDone }: { plan: RestorePlan; onDone: () => void }) {
  const people = usePeople();
  const online = useOnline();
  const toast = useToast();
  const members = people.list;
  const [map, setMap] = useState<Record<string, string>>(() => defaultPeopleMap(plan, members));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const both = members.length === 2;
  const c = plan.counts;
  const also: string[] = [];
  if (c.regular > 0) also.push(strings.restore.regular(c.regular));
  if (c.comments > 0) also.push(strings.restore.comments(c.comments));
  if (c.categories > 0) also.push(strings.restore.categories(c.categories));
  if (c.rules > 0) also.push(strings.restore.rules(c.rules));
  const nothing = c.entries + c.settleUps + c.chapters + also.length === 0;
  const [p, q] = plan.people;
  const choose = (who: string, member: string) => {
    if (!p || !q) return;
    const other = members.find((m) => m.id !== member)?.id ?? '';
    setMap(who === p.id ? { [p.id]: member, [q.id]: other } : { [q.id]: member, [p.id]: other });
  };
  const swap = () => {
    if (!p || !q) return;
    setMap({ [p.id]: map[q.id] ?? '', [q.id]: map[p.id] ?? '' });
  };
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const done = await restoreBackup(plan, map);
      const added = Object.values(done.added).reduce((t, v) => t + v, 0);
      toast.show({ message: strings.restore.done(added) });
      onDone();
    } catch (err) {
      // Review fix 9: the part of the backup the database refused, in plain words.
      setError(err instanceof RestoreRefusedError ? strings.restore.refusedAt(strings.restore.parts[err.table]) : plainError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div role="status" className="flex flex-col gap-1">
        {nothing ? (
          <p className="m-0">{strings.restore.nothing}</p>
        ) : (
          <>
            <p className="m-0">{strings.restore.adds(c.entries, c.settleUps, c.chapters)}</p>
            {also.length > 0 ? <p className="m-0">{strings.restore.also(also)}</p> : null}
          </>
        )}
        <p className="text-secondary text-ink-2 m-0">{strings.restore.unchanged}</p>
      </div>
      {both && p && q ? (
        <div className="flex flex-col gap-4">
          {[p, q].map((who, i) => (
            <Select
              key={who.id}
              label={strings.restore.is(who.name.trim() !== '' ? who.name : i === 0 ? strings.restore.firstPerson : strings.restore.secondPerson)}
              value={map[who.id] ?? ''}
              onChange={(v) => { choose(who.id, v); }}
            >
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          ))}
          <div>
            <Button variant="plain" onClick={swap}>{strings.restore.swap}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      {!both ? (
        <p className="text-body m-0">{strings.restore.needsPartner}</p>
      ) : !online ? (
        <p className="text-body m-0">{strings.restore.needsConnection}</p>
      ) : (
        <Button block loading={busy} disabled={nothing} onClick={() => void restore()}>{strings.restore.restore}</Button>
      )}
    </div>
  );
}

// ───────────────────────────── Storage ─────────────────────────────

const MB = 1024 * 1024;

export function StorageSection() {
  const layer = useDataLayer();
  const today = layer.today();
  const online = useOnline();
  const [state, setState] = useState<{ figure: StorageFigure | null; fresh: boolean; asked: boolean }>(() => ({ figure: lastStorageUsed(), fresh: false, asked: false }));
  useEffect(() => {
    let live = true;
    void storageUsed(layer).then((got) => { if (live) setState({ ...got, asked: true }); });
    return () => { live = false; };
  }, [layer, online]);
  const f = state.figure;
  if (!f) return <p className="text-secondary text-ink-2 m-0 min-h-6">{state.asked ? strings.storage.unknown : strings.storage.loading}</p>;
  const full = f.databaseBytes >= FREE_DATABASE_BYTES * NEARLY_FULL || f.photoBytes >= FREE_PHOTO_BYTES * NEARLY_FULL;
  const day = f.at.slice(0, 10);
  return (
    <div className="flex flex-col gap-1">
      <p className="nums-list m-0">{strings.storage.line(Math.round(f.databaseBytes / MB), Math.round(f.photoBytes / MB))}</p>
      {full ? <p role="alert" className="text-secondary text-berry m-0">{strings.storage.nearlyFull}</p> : null}
      {!state.fresh && state.asked && isIsoDate(day) ? <p className="text-caption text-ink-2 m-0">{strings.storage.asOf(formatDate(day, today))}</p> : null}
    </div>
  );
}

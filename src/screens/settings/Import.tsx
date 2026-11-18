/**
 * S7 (IMP-1, IMP-3, OFF-3): Settings → "Import from a bank statement". The CSV is read on this phone (core/csv);
 * a Monzo export is recognised by its header, any other file goes through the mapping step. The summary says what
 * will be offered, what the household's rules will do and what is left out; "Import N rows" puts the rows in this
 * phone's Inbox (src/data/imports.ts). Also Settings → "Import rules", and the file picker and select both use.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DATE_FORMATS, decodeCsv, detectPreset, MAX_CSV_BYTES, MAX_CSV_ROWS, MONZO_MAPPING, parseCsv, readRows, type ColumnMapping, type DateFormat,
} from '../../core/csv';
import { addDays, formatDate, isIsoDate, type IsoDate } from '../../core/dates';
import {
  previewImport, removeImportRule, startImport, useAllImportRules, useCategories, useDataLayer, useHousehold, type ImportCounts, type ImportRuleView,
} from '../../data';
import { Button, Field, Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { plainError } from '../shared/plain';

// ───────────────────────────── shared pieces ─────────────────────────────

/** A file input that looks like a plain button: the label is the button, the input is there for every way of choosing. */
export function FilePick({ label, accept, onPick }: { label: string; accept: string; onPick: (file: File) => void }) {
  const id = useId();
  return (
    <div>
      <input
        id={id}
        type="file"
        accept={accept}
        className="peer sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
      <label
        htmlFor={id}
        className={cx(
          'bg-sunk text-ink text-body press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full px-5 py-2.5 font-semibold select-none',
          'peer-focus-visible:outline-forest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid',
        )}
      >
        {label}
      </label>
    </div>
  );
}

/** A labelled native select on a sunk well (as Settle day's). */
export function Select({ label, value, onChange, children, hint }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary text-ink-2 font-medium">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        className="bg-sunk text-ink text-body min-h-12 w-full min-w-0 rounded-[12px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {children}
      </select>
      {hint ? <p id={`${id}-hint`} className="text-secondary text-ink-2 m-0">{hint}</p> : null}
    </div>
  );
}

/** A file's bytes. */
function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : new Uint8Array()); };
    reader.onerror = () => { reject(reader.error ?? new Error('could not read the file')); };
    reader.readAsArrayBuffer(file);
  });
}

/** A file's text: UTF-8, or windows-1252 when it isn't (a bank's "£" still reads; core decodeCsv). */
export async function fileText(file: File): Promise<string> {
  return decodeCsv(await fileBytes(file));
}

// ───────────────────────────── Settings → Import from a bank statement ─────────────────────────────

export function ImportSection() {
  const [table, setTable] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = (file: File) => {
    setError(null);
    // IMP-1: at most 5 MB and 20,000 rows, checked before anything else is done with it.
    if (file.size > MAX_CSV_BYTES) {
      setError(strings.imports.tooBig);
      return;
    }
    void fileText(file).then((text) => {
      const rows = parseCsv(text);
      if (rows.length - 1 > MAX_CSV_ROWS) setError(strings.imports.tooBig);
      else if (rows.length < 2) setError(strings.imports.unreadable);
      else setTable(rows);
    }, () => { setError(strings.imports.unreadable); });
  };
  return (
    <>
      <p className="text-secondary text-ink-2 m-0">{strings.imports.sectionLine}</p>
      <FilePick label={strings.imports.choose} accept=".csv,text/csv,text/comma-separated-values" onPick={pick} />
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      <ImportSheet table={table} onClose={() => { setTable(null); }} />
    </>
  );
}

function guessColumn(header: readonly string[], pattern: RegExp): number | null {
  const i = header.findIndex((h) => pattern.test(h.trim()));
  return i === -1 ? null : i;
}

/** The mapping step's starting point: columns guessed from common header names, spending shown as negative. */
function guessMapping(table: readonly (readonly string[])[]): ColumnMapping {
  const header = table[0] ?? [];
  const date = guessColumn(header, /date|posted|when/i) ?? 0;
  const description = guessColumn(header, /desc|details|name|narrative|payee|merchant|what/i) ?? (header.length > 1 ? 1 : 0);
  const amount = guessColumn(header, /^(amount|value)$/i);
  const moneyOut = guessColumn(header, /out|debit|paid out/i);
  const moneyIn = guessColumn(header, /\bin\b|credit|paid in/i);
  const firstDate = (table[1]?.[date] ?? '').trim();
  const dateFormat: DateFormat = /^\d{4}-\d{1,2}-\d{1,2}/u.test(firstDate) ? 'yyyy-mm-dd' : 'dd/mm/yyyy';
  const split = amount === null && (moneyOut !== null || moneyIn !== null);
  return {
    date, description, bankId: null, dateFormat, amount: split ? null : (amount ?? guessColumn(header, /amount|value/i)),
    spending: 'negative', moneyOut: split ? moneyOut : null, moneyIn: split ? moneyIn : null,
  };
}

const num = (v: string): number | null => (v === '' ? null : Number(v));

function ImportSheet({ table, onClose }: { table: string[][] | null; onClose: () => void }) {
  const open = table !== null;
  // The sheet keeps showing the last file while it slides away.
  const [shown, setShown] = useState<string[][] | null>(table);
  if (table !== null && table !== shown) setShown(table);
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={strings.imports.title}>
      {shown ? <ImportForm key={`${String(shown.length)}:${shown[0]?.join(',') ?? ''}`} table={shown} onDone={onClose} /> : null}
    </Sheet>
  );
}

function ImportForm({ table, onDone }: { table: string[][]; onDone: () => void }) {
  const layer = useDataLayer();
  const today = layer.today();
  const toast = useToast();
  const household = useHousehold().data;
  const header = table[0] ?? [];
  const monzo = detectPreset(header) === 'monzo';
  const [mapping, setMapping] = useState<ColumnMapping>(() => guessMapping(table));
  // Decision (S7 open points): from the household's first day (90 days back if unknown).
  const started = household?.created_at.slice(0, 10);
  const [from, setFrom] = useState<string>(started && isIsoDate(started) ? started : addDays(today, -90));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = monzo ? 'monzo' : 'csv';
  const read = useMemo(() => readRows(table, monzo ? MONZO_MAPPING : mapping), [table, monzo, mapping]);
  const fromDay: IsoDate | null = isIsoDate(from) ? from : null;
  const rows = useMemo(() => (fromDay === null ? read.rows : read.rows.filter((r) => r.date >= fromDay)), [read, fromDay]);
  const before = read.rows.length - rows.length;

  const [counts, setCounts] = useState<{ for: typeof rows; counts: ImportCounts } | null>(null);
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
    let live = true;
    void previewImport(rows, source, layer).then((c) => { if (live && latest.current === rows) setCounts({ for: rows, counts: c }); }, () => undefined);
    return () => { live = false; };
  }, [rows, source, layer]);
  const now = counts?.for === rows ? counts.counts : null;
  const n = now ? now.offered + now.rules.keep : 0;

  const left: string[] = [];
  if (read.left.moneyIn > 0) left.push(strings.imports.paymentsIn(read.left.moneyIn));
  if (read.left.pots > 0) left.push(strings.imports.pots(read.left.pots));
  if (read.left.unreadable > 0) left.push(strings.imports.unreadableRows(read.left.unreadable));
  if (before > 0 && fromDay !== null) left.push(strings.imports.before(before, formatDate(fromDay, today)));

  const set = (patch: Partial<ColumnMapping>) => { setMapping((m) => ({ ...m, ...patch })); };
  const columns = header.map((h, i) => <option key={String(i)} value={String(i)}>{strings.imports.column(h, i + 1)}</option>);
  const spendingId = useId();

  const go2 = async () => {
    if (busy || n === 0) return;
    setBusy(true);
    setError(null);
    try {
      const done = await startImport(rows, source, layer);
      const message = done.offered > 0 ? strings.imports.imported(done.offered) : strings.imports.keptByRules(done.rules.keep);
      toast.show({ message });
      onDone();
      if (done.offered > 0) go({ name: 'inbox' });
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {monzo ? (
        <p className="text-subtitle m-0">{strings.imports.monzo}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-secondary text-ink-2 m-0">{strings.imports.mapLine}</p>
          <Select label={strings.imports.dateColumn} value={String(mapping.date)} onChange={(v) => { set({ date: Number(v) }); }}>{columns}</Select>
          <Select label={strings.imports.dateFormat} value={mapping.dateFormat} onChange={(v) => { set({ dateFormat: v as DateFormat }); }}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Select label={strings.imports.descriptionColumn} value={String(mapping.description)} onChange={(v) => { set({ description: Number(v) }); }}>{columns}</Select>
          <Select
            label={strings.imports.amountColumn}
            value={mapping.amount === null ? '' : String(mapping.amount)}
            onChange={(v) => { set({ amount: num(v) }); }}
          >
            {columns}
            <option value="">{strings.imports.separate}</option>
          </Select>
          {mapping.amount !== null ? (
            <div className="flex flex-col gap-1.5">
              <p id={spendingId} className="text-secondary text-ink-2 m-0 font-medium">{strings.imports.spending}</p>
              <div role="radiogroup" aria-labelledby={spendingId} className="flex flex-col">
                {(['negative', 'positive'] as const).map((v) => (
                  <label key={v} className="press flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name={`${spendingId}-spending`}
                      value={v}
                      checked={mapping.spending === v}
                      onChange={() => { set({ spending: v }); }}
                      className="accent-forest size-5 shrink-0"
                    />
                    <span className="text-body">{v === 'negative' ? strings.imports.negative : strings.imports.positive}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <>
              <Select label={strings.imports.moneyOutColumn} value={mapping.moneyOut === null ? '' : String(mapping.moneyOut)} onChange={(v) => { set({ moneyOut: num(v) }); }}>
                <option value="">{strings.imports.none}</option>
                {columns}
              </Select>
              <Select label={strings.imports.moneyInColumn} value={mapping.moneyIn === null ? '' : String(mapping.moneyIn)} onChange={(v) => { set({ moneyIn: num(v) }); }}>
                <option value="">{strings.imports.none}</option>
                {columns}
              </Select>
            </>
          )}
          <Select label={strings.imports.bankIdColumn} value={mapping.bankId === null ? '' : String(mapping.bankId)} onChange={(v) => { set({ bankId: num(v) }); }}>
            <option value="">{strings.imports.none}</option>
            {columns}
          </Select>
        </div>
      )}
      <Field type="date" label={strings.imports.from} value={from} max={today} hint={strings.imports.fromHint} onChange={(e) => { setFrom(e.target.value); }} />
      <div role="status" className="text-secondary flex min-h-12 flex-col gap-1">
        {now ? (
          <>
            {now.offered > 0 ? <p className="m-0">{strings.imports.toReview(now.offered)}</p> : null}
            {now.rules.keep + now.rules.skip > 0 ? <p className="m-0">{strings.imports.rules(now.rules.keep, now.rules.skip)}</p> : null}
            {now.already > 0 ? <p className="text-ink-2 m-0">{strings.imports.already(now.already)}</p> : null}
            {left.length > 0 ? <p className="text-ink-2 m-0">{strings.imports.leftOut(left)}</p> : null}
          </>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      <div className="min-h-11">
        {now && n === 0 ? (
          <p className="text-body m-0">{strings.imports.nothingNew}</p>
        ) : (
          <Button block loading={busy || !now} onClick={() => void go2()}>{strings.imports.importN(n)}</Button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Settings → Import rules ─────────────────────────────

export function ImportRulesSection() {
  const rules = useAllImportRules() ?? [];
  const categories = useCategories().data ?? [];
  const toast = useToast();
  const words = (r: ImportRuleView) => (r.decision === 'keep'
    ? strings.imports.ruleKeep(r.match_text, categories.find((c) => c.id === r.category_id)?.name ?? null)
    : strings.imports.ruleSkip(r.match_text));
  if (rules.length === 0) return <p className="text-secondary text-ink-2 m-0">{strings.imports.rulesNone}</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rules.map((r) => (
        <li key={r.id} className="border-line flex min-h-14 items-center gap-3 border-b py-1 last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body break-words">{words(r)}</span>
            {/* Review fix 2: a skip rule names a merchant one person left out, so it is never shared. */}
            {r.onThisPhone ? <span className="text-secondary text-ink-2">{strings.imports.onThisPhone}</span> : null}
          </span>
          <Button
            variant="quiet"
            aria-label={strings.imports.removeRule(r.match_text)}
            onClick={() => {
              try {
                removeImportRule(r.id);
                toast.show({ message: strings.imports.removed });
              } catch (err) {
                toast.show({ message: plainError(err) });
              }
            }}
          >
            {strings.imports.remove}
          </Button>
        </li>
      ))}
    </ul>
  );
}

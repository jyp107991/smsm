/**
 * S7 (IMP-1, EXP-1): bank statements in, entries out, as CSV. Pure: the phone reads the file and hands the text
 * here; nothing leaves the phone while reading.
 *
 * Reading: RFC 4180 (a BOM, CRLF or LF, quoted fields holding commas, quotes and newlines). A statement is
 * turned into spending rows only (money in, zero and unreadable rows are counted and left out). The Monzo
 * preset is chosen by its header (docs/slices/S7.md); any other file is read through a column mapping.
 *
 * Writing: one row per entry and settle-up, amounts as plain pounds, cells that a spreadsheet would run as a
 * formula prefixed with an apostrophe.
 */
import { isIsoDate, type IsoDate } from './dates';
import type { InsightEntry, InsightSettlement } from './insights';
import { formatPlainPounds, parseStatementAmount, pence, type Pence } from './money';

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20_000;
const MAX_PENCE = 100_000_000;
const DESCRIPTION_MAX = 120;

/** A CSV file's text as rows of cells. Blank lines are dropped; rows may have different lengths. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    cell = '';
  };
  while (i < s.length) {
    const ch = s[i] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i += 1; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (ch === '\r') { endRow(); i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    cell += ch; i += 1;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

export type ImportSource = 'monzo' | 'csv';
export type DateFormat = 'dd/mm/yyyy' | 'yyyy-mm-dd' | 'mm/dd/yyyy';
export const DATE_FORMATS: readonly DateFormat[] = ['dd/mm/yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy'];

/**
 * The generic mapping step: which column (by its index in the header row, since bank headers can repeat or be
 * blank) holds what. Either one signed Amount column (with how spending is shown) or Money out + Money in.
 */
export interface ColumnMapping {
  date: number;
  description: number;
  bankId: number | null;
  dateFormat: DateFormat;
  amount: number | null;
  spending: 'negative' | 'positive';
  moneyOut: number | null;
  moneyIn: number | null;
}

/** The Monzo preset: Monzo's columns, found by header name (any order and case). */
export const MONZO_MAPPING = {
  preset: 'monzo',
  date: 'Date',
  description: 'Name',
  fallbackDescription: 'Description',
  amount: 'Amount',
  bankId: 'Transaction ID',
  category: 'Category',
  type: 'Type',
  localAmount: 'Local amount',
  localCurrency: 'Local currency',
} as const;
export type MonzoMapping = typeof MONZO_MAPPING;

const key = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** 'monzo' when the header is a Monzo export's (any order and case; extra columns ignored), else null. */
export function detectPreset(header: readonly string[]): 'monzo' | null {
  const have = new Set(header.map(key));
  return ['transaction id', 'date', 'name', 'amount'].every((h) => have.has(h)) ? 'monzo' : null;
}

export interface BankRow {
  /** The bank's own id for the row, or one made from the row (`gen:…`) when the file has none. */
  bankId: string;
  date: IsoDate;
  description: string;
  /** What was spent, in pence (always more than 0). */
  amount: Pence;
  /** The bank's category name (Monzo), to match a category of the same name. */
  categoryHint: string | null;
  /** "Paid €89.99" when the merchant charged another currency. */
  note: string | null;
}

export interface ReadResult {
  rows: BankRow[];
  left: { moneyIn: number; unreadable: number; pots: number };
}

/** A date as a statement writes it, in the given format: "01/08/2026", "1/8/26", "2026-08-01", "2026-08-01 10:02". */
export function readDate(text: string, format: DateFormat): IsoDate | null {
  const t = text.normalize('NFKC').trim().split(/[ T]/u)[0] ?? '';
  const parts = t.split(/[/.-]/u);
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/u.test(p))) return null;
  const [p0, p1, p2] = parts as [string, string, string];
  const [y, m, d] = format === 'yyyy-mm-dd' ? [p0, p1, p2] : format === 'dd/mm/yyyy' ? [p2, p1, p0] : [p2, p0, p1];
  if (y.length !== 4 && y.length !== 2) return null;
  if (m.length > 2 || d.length > 2) return null;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', JPY: '¥', KRW: '₩', GBP: '£' };

/** FNV-1a over the text, as 8 hex digits: a stable id for a row whose bank gives none. Not a secret. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function tidy(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, DESCRIPTION_MAX).trim();
}

/** Column indices (-1 for none) after a mapping is resolved against the header. */
interface Columns {
  date: number; description: number; fallback: number; amount: number; out: number; in: number; id: number;
  category: number; type: number; local: number; localCurrency: number;
  dateFormat: DateFormat; spending: 'negative' | 'positive';
}

function isMonzo(mapping: MonzoMapping | ColumnMapping): mapping is MonzoMapping {
  return 'preset' in mapping;
}

function columns(header: readonly string[], mapping: MonzoMapping | ColumnMapping): Columns {
  if (isMonzo(mapping)) {
    const names = header.map(key);
    const col = (name: string) => names.indexOf(key(name));
    return {
      date: col(mapping.date), description: col(mapping.description), fallback: col(mapping.fallbackDescription),
      amount: col(mapping.amount), out: -1, in: -1, id: col(mapping.bankId), category: col(mapping.category),
      type: col(mapping.type), local: col(mapping.localAmount), localCurrency: col(mapping.localCurrency),
      dateFormat: 'dd/mm/yyyy', spending: 'negative',
    };
  }
  const ix = (n: number | null) => (n === null ? -1 : n);
  return {
    date: mapping.date, description: mapping.description, fallback: -1, amount: ix(mapping.amount),
    out: mapping.amount === null ? ix(mapping.moneyOut) : -1, in: mapping.amount === null ? ix(mapping.moneyIn) : -1,
    id: ix(mapping.bankId), category: -1, type: -1, local: -1, localCurrency: -1,
    dateFormat: mapping.dateFormat, spending: mapping.spending,
  };
}

/** The spending rows of a statement (its first row is the header), through the Monzo preset or a column mapping. */
export function readRows(table: readonly (readonly string[])[], mapping: MonzoMapping | ColumnMapping): ReadResult {
  const c = columns(table[0] ?? [], mapping);
  const at = (row: readonly string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '');
  const rows: BankRow[] = [];
  const left = { moneyIn: 0, unreadable: 0, pots: 0 };
  const seen = new Map<string, number>();
  for (const row of table.slice(1)) {
    if (c.type >= 0 && key(at(row, c.type)) === 'pot transfer') { left.pots += 1; continue; }
    const date = readDate(at(row, c.date), c.dateFormat);
    const description = tidy(at(row, c.description) || at(row, c.fallback));
    let spent: number | null = null;
    if (c.amount >= 0) {
      const v = parseStatementAmount(at(row, c.amount));
      if (v !== null) spent = c.spending === 'negative' ? -v : v;
    } else if (c.out >= 0 || c.in >= 0) {
      const outText = at(row, c.out);
      const inText = at(row, c.in);
      const out = outText === '' ? 0 : parseStatementAmount(outText);
      const inn = inText === '' ? 0 : parseStatementAmount(inText);
      if (out !== null && inn !== null && (outText !== '' || inText !== '')) spent = Math.abs(out) - Math.abs(inn);
    }
    if (spent === null || date === null || description === '') { left.unreadable += 1; continue; }
    // A zero (a card check) is not spending: counted with the payments in.
    if (spent <= 0) { left.moneyIn += 1; continue; }
    if (spent > MAX_PENCE) { left.unreadable += 1; continue; }
    let bankId = at(row, c.id);
    if (bankId === '') {
      const base = `${date}|${String(spent)}|${description.toLowerCase()}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      bankId = `gen:${fnv(base)}:${String(n)}`;
    }
    const currency = at(row, c.localCurrency).toUpperCase();
    const local = at(row, c.local).replace(/^[-−]/u, '');
    const symbol = SYMBOLS[currency];
    const note = currency !== '' && currency !== 'GBP' && local !== ''
      ? (symbol ? `Paid ${symbol}${local}` : `Paid ${local} ${currency}`)
      : null;
    rows.push({ bankId, date, description, amount: pence(spent), categoryHint: at(row, c.category) || null, note });
  }
  return { rows, left };
}

/** A cell as CSV writes it: quoted when needed; a leading =, +, -, @, tab or CR gets an apostrophe first. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export type ExportEntry = InsightEntry & { notes: string | null };
export type ExportSettlement = InsightSettlement & { id: string; note: string | null };
export interface Named { id: string; name: string }

export const EXPORT_COLUMNS = (a: string, b: string) => [
  'Date', 'Type', 'Description', 'Category', 'Chapter', 'Country', 'Amount', 'Paid by', `${a}'s share`, `${b}'s share`, 'Notes', 'Deleted',
];

/**
 * EXP-1: entries and settle-ups dated from `range.from` to `range.to` (both included), oldest first, as a CSV
 * file's text (BOM, CRLF). Deleted ones are included and marked.
 */
export function exportCsv(
  entries: readonly ExportEntry[],
  settlements: readonly ExportSettlement[],
  people: readonly [Named, Named],
  categories: readonly Named[],
  chapters: readonly Named[],
  range: { from: IsoDate; to: IsoDate },
): string {
  const [a, b] = people;
  const nameOf = (list: readonly Named[], id: string | null) => (id === null ? '' : (list.find((x) => x.id === id)?.name ?? ''));
  const person = (id: string) => (id === a.id ? a.name : id === b.id ? b.name : '');
  const inRange = (d: IsoDate) => d >= range.from && d <= range.to;
  const lines: { date: IsoDate; cells: string[] }[] = [];
  for (const e of entries) {
    if (!inRange(e.date)) continue;
    const payers = [a, b].filter((p) => (e.paid[p.id] ?? 0) > 0);
    lines.push({
      date: e.date,
      cells: [
        e.date, e.kind === 'money_back' ? 'Money back' : 'Expense', e.description, nameOf(categories, e.categoryId),
        nameOf(chapters, e.chapterId), e.country ?? '', formatPlainPounds(e.amount), payers.map((p) => p.name).join(' and '),
        formatPlainPounds(e.shares[a.id] ?? pence(0)), formatPlainPounds(e.shares[b.id] ?? pence(0)), e.notes ?? '', e.deleted ? 'yes' : '',
      ],
    });
  }
  for (const s of settlements) {
    if (!inRange(s.date)) continue;
    lines.push({
      date: s.date,
      cells: [s.date, 'Settle-up', `${person(s.from)} paid ${person(s.to)}`, '', '', '', formatPlainPounds(s.amount), person(s.from), '', '', s.note ?? '', s.deleted ? 'yes' : ''],
    });
  }
  lines.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const out = [EXPORT_COLUMNS(a.name, b.name), ...lines.map((l) => l.cells)].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${out.join('\r\n')}\r\n`;
}

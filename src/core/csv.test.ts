/**
 * S7 core (docs/slices/S7.md "Decisions made here → Monzo preset, Generic CSV, Only spending, Reading, CSV export",
 * "Data → Core", "Tests → Core"; SPEC IMP-1, EXP-1, OFF-3): reading a bank statement on the phone and writing the
 * entries CSV, both pure. Written before the build (ENGINEERING §5, tests first by someone else); each test names its
 * SPEC ids.
 *
 * Interface these tests expect, in src/core/csv.ts (pure; no I/O, no clock; money in integer pence):
 *
 *   parseCsv(text: string): string[][]
 *     RFC 4180: a leading BOM dropped; CRLF or LF; quoted fields with commas, doubled quotes and line breaks (kept as
 *     they are inside the quotes); an empty trailing line is not a row; ragged rows come back as they are (no padding).
 *     '' → [].
 *   detectPreset(header: readonly string[]): 'monzo' | null
 *     'monzo' when the header has Transaction ID, Date, Name and Amount (any order, any case; extra columns ignored).
 *   interface BankRow { bankId: string; date: IsoDate; description: string; amount: Pence; categoryHint: string | null; note: string | null }
 *   MONZO_MAPPING: the Monzo preset, passed to readRows as a mapping (it finds Monzo's columns by header name, any order
 *     and case).
 *   readRows(table: string[][], mapping: typeof MONZO_MAPPING | ColumnMapping)
 *     → { rows: BankRow[]; left: { moneyIn: number; unreadable: number; pots: number } }
 *     table[0] is the header row; the rest are the statement's rows, in file order.
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - ColumnMapping (the generic mapping step) names columns by their INDEX in the header row (header names can repeat
 *     or be blank in bank exports):
 *       { date: number; description: number; bankId: number | null; dateFormat: 'dd/mm/yyyy' | 'yyyy-mm-dd' | 'mm/dd/yyyy';
 *         amount: number | null; spending: 'negative' | 'positive';   // one signed Amount column …
 *         moneyOut: number | null; moneyIn: number | null }            // … or Money out + Money in (amount null)
 *   - A "Money out" cell is read by its size: "12.50" and "-12.50" are both £12.50 spent (some banks sign it, as Monzo's
 *     own Money Out column does). A row whose Money out is empty and Money in has a figure is a payment in.
 *   - Rows left out: money in → left.moneyIn; unreadable date or amount → left.unreadable; Monzo "Pot transfer" →
 *     left.pots. Where a zero amount is counted (moneyIn or unreadable) is left to the builder; the tests only check it
 *     is left out and counted in one of the two.
 *   - A generated id (no bank id column) is "gen:" + a hash of date, amount, description and the row's position among
 *     identical rows (same date, amount and description) in the file, so an unrelated row added elsewhere changes no id.
 *   - exportCsv(entries: ExportEntry[], settlements: ExportSettlement[], people: readonly [{ id, name }, { id, name }],
 *       categories: readonly { id, name }[], chapters: readonly { id, name }[], range: { from: IsoDate; to: IsoDate }): string
 *       ExportEntry = InsightEntry (src/core/insights.ts) & { notes: string | null }
 *       ExportSettlement = InsightSettlement & { id: string; note: string | null }
 *     The Date column is the ISO date (YYYY-MM-DD, as the file name). Category / Chapter: the name, blank for none.
 *     Paid by: the name of the person who paid (one payer). Shares: plain pounds ("0.00" for none). Deleted: "yes" or
 *     blank. Rows: every entry and settle-up dated from..to inclusive, deleted ones included. The tests find rows by
 *     description / type, not by position. Settle-up rows: Type "Settle-up", Amount, Paid by = who paid; their other
 *     cells are not checked here.
 *   - csvCell(s: string): string — the cell as written: a cell starting =, +, -, @, tab or CR gets a leading ', then a
 *     cell holding a comma, a quote, CR or LF is quoted (quotes doubled).
 *
 * Until src/core/csv.ts exists it is loaded by a computed path (so this file type-checks and each test fails on the
 * missing module); once it exists this can become `import * as csv from './csv'`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from './dates';
import type { InsightEntry, InsightSettlement } from './insights';
import { parseAmount, pence, type Pence } from './money';
import type { UserId } from './split';

interface BankRow { bankId: string; date: IsoDate; description: string; amount: Pence; categoryHint: string | null; note: string | null }
type DateFormat = 'dd/mm/yyyy' | 'yyyy-mm-dd' | 'mm/dd/yyyy';
interface ColumnMapping {
  date: number; description: number; bankId: number | null; dateFormat: DateFormat;
  amount: number | null; spending: 'negative' | 'positive'; moneyOut: number | null; moneyIn: number | null;
}
interface Read { rows: BankRow[]; left: { moneyIn: number; unreadable: number; pots: number } }
type ExportEntry = InsightEntry & { notes: string | null };
type ExportSettlement = InsightSettlement & { id: string; note: string | null };
type Named = { id: string; name: string };
interface CsvCore {
  parseCsv: (text: string) => string[][];
  detectPreset: (header: readonly string[]) => 'monzo' | null;
  readRows: (table: readonly (readonly string[])[], mapping: unknown) => Read;
  MONZO_MAPPING: unknown;
  exportCsv: (entries: readonly ExportEntry[], settlements: readonly ExportSettlement[], people: readonly [Named, Named],
    categories: readonly Named[], chapters: readonly Named[], range: { from: IsoDate; to: IsoDate }) => string;
  csvCell: (s: string) => string;
}

const FUNCTIONS = ['parseCsv', 'detectPreset', 'readRows', 'exportCsv', 'csvCell'] as const;
const CSV = './csv';
const loaded = (await import(/* @vite-ignore */ CSV).catch(() => null)) as Partial<CsvCore> | null;
function core(): CsvCore {
  const missing: string[] = FUNCTIONS.filter((n) => typeof loaded?.[n] !== 'function');
  if (loaded?.MONZO_MAPPING === undefined) missing.push('MONZO_MAPPING');
  if (!loaded || missing.length > 0) throw new Error(`src/core/csv.ts does not export ${missing.join(', ')} yet (S7)`);
  return loaded as CsvCore;
}

const MONZO_HEADER = [
  'Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category', 'Amount', 'Currency', 'Local amount', 'Local currency',
  'Notes and #tags', 'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In',
];
/** A Monzo row in the header's order, from the fields that matter. */
function monzo(f: { id: string; date: string; type?: string; name: string; category?: string; amount: string; local?: string; currency?: string; description?: string }): string[] {
  const local = f.local ?? f.amount;
  const out = f.amount.startsWith('-') ? f.amount : '';
  const into = f.amount.startsWith('-') ? '' : f.amount;
  return [f.id, f.date, '12:00:00', f.type ?? 'Card payment', f.name, '', f.category ?? '', f.amount, 'GBP', local, f.currency ?? 'GBP', '', '', '', f.description ?? '', '', out, into];
}
const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8');

// ─────────────────────────────── parseCsv ───────────────────────────────

describe('parseCsv: RFC 4180 on the phone (IMP-1, OFF-3)', () => {
  it('IMP-1: rows and cells, LF or CRLF; an empty trailing line is not a row', () => {
    const { parseCsv } = core();
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('IMP-1: a byte-order mark at the start is dropped', () => {
    expect(core().parseCsv('\uFEFFTransaction ID,Date\r\ntx_1,02/11/2026\r\n')).toEqual([['Transaction ID', 'Date'], ['tx_1', '02/11/2026']]);
  });

  it('IMP-1: quoted fields keep commas, doubled quotes and line breaks', () => {
    const { parseCsv } = core();
    expect(parseCsv('"Noodle Bar, Soho",-18.20')).toEqual([['Noodle Bar, Soho', '-18.20']]);
    expect(parseCsv('"say ""hi""",2')).toEqual([['say "hi"', '2']]);
    expect(parseCsv('"line one\nline two",x\r\nnext,y\r\n')).toEqual([['line one\nline two', 'x'], ['next', 'y']]);
    expect(parseCsv('"a\r\nb",c')).toEqual([['a\r\nb', 'c']]);
    expect(parseCsv('"",x')).toEqual([['', 'x']]);
  });

  it('IMP-1: empty cells stay empty; ragged rows come back as they are', () => {
    const { parseCsv } = core();
    expect(parseCsv('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']]);
    expect(parseCsv('a,b,c\n1,2\n1,2,3,4\n')).toEqual([['a', 'b', 'c'], ['1', '2'], ['1', '2', '3', '4']]);
  });

  it('IMP-1: nothing in, nothing out', () => {
    expect(core().parseCsv('')).toEqual([]);
  });

  it('IMP-1: the Monzo sample fixture reads to a header and seven rows of eighteen cells', () => {
    const table = core().parseCsv(fixture('monzo-sample.csv'));
    expect(table[0]).toEqual(MONZO_HEADER);
    expect(table).toHaveLength(8);
    for (const row of table) expect(row).toHaveLength(18);
    expect(table[4]?.[4]).toBe('Noodle Bar, Soho');
    expect(table[7]?.[11]).toBe('Notes with "quotes"');
  });
});

// ─────────────────────────────── detectPreset ───────────────────────────────

describe('detectPreset: is it a Monzo statement? (IMP-1)', () => {
  it('IMP-1: Monzo’s personal export header is Monzo', () => {
    expect(core().detectPreset(MONZO_HEADER)).toBe('monzo');
  });

  it('IMP-1: in any order and any case, extra columns ignored', () => {
    expect(core().detectPreset(['amount', 'NAME', 'Something else', 'date', 'transaction id'])).toBe('monzo');
    expect(core().detectPreset(['Transaction ID', 'Date', 'Name', 'Amount'])).toBe('monzo');
  });

  it('IMP-1: a business account’s export (with Balance columns) is Monzo too', () => {
    expect(core().detectPreset([...MONZO_HEADER, 'Balance', 'Balance currency'])).toBe('monzo');
  });

  it('IMP-1: anything else is not: a missing column, another bank, nothing', () => {
    const { detectPreset } = core();
    expect(detectPreset(MONZO_HEADER.filter((h) => h !== 'Name'))).toBeNull();
    expect(detectPreset(MONZO_HEADER.filter((h) => h !== 'Transaction ID'))).toBeNull();
    expect(detectPreset(['Posted', 'Details', 'Value', 'Reference'])).toBeNull();
    expect(detectPreset(['Date', 'Description', 'Money out', 'Money in', 'Balance'])).toBeNull();
    expect(detectPreset([])).toBeNull();
  });
});

// ─────────────────────────────── readRows: Monzo ───────────────────────────────

describe('readRows with the Monzo preset (IMP-1)', () => {
  it('IMP-1: the sample: five spending rows, one payment in and one pot transfer left out', () => {
    const { parseCsv, readRows, MONZO_MAPPING } = core();
    const read = readRows(parseCsv(fixture('monzo-sample.csv')), MONZO_MAPPING);
    expect(read.left).toEqual({ moneyIn: 1, unreadable: 0, pots: 1 });
    expect(read.rows).toEqual([
      { bankId: 'tx_0000TESTSAMPLE0001', date: '2026-11-02', description: 'Larder & Leaf', amount: 4250, categoryHint: 'Groceries', note: null },
      { bankId: 'tx_0000TESTSAMPLE0004', date: '2026-11-05', description: 'Noodle Bar, Soho', amount: 1820, categoryHint: 'Eating out', note: null },
      { bankId: 'tx_0000TESTSAMPLE0005', date: '2026-11-07', description: 'Café Lumière', amount: 7842, categoryHint: 'Eating out', note: 'Paid €89.99' },
      { bankId: 'tx_0000TESTSAMPLE0006', date: '2026-11-09', description: 'Metro Ticket Machine', amount: 280, categoryHint: 'Transport', note: null },
      // No Name: the Description stands in.
      { bankId: 'tx_0000TESTSAMPLE0007', date: '2026-11-10', description: 'HARDWARE CORNER, EXAMPLETOWN', amount: 1200, categoryHint: 'Shopping', note: null },
    ]);
  });

  it('IMP-1: Amount is signed with spending negative; the amount is −Amount, in pence', () => {
    const { readRows, MONZO_MAPPING } = core();
    const read = readRows([MONZO_HEADER, monzo({ id: 'tx_a', date: '14/11/2026', name: 'Larder & Leaf', amount: '-1234.56' })], MONZO_MAPPING);
    expect(read.rows.map((r) => r.amount)).toEqual([123456]);
  });

  it('IMP-1: pot transfers are left out (either way) and counted', () => {
    const { readRows, MONZO_MAPPING } = core();
    const read = readRows([
      MONZO_HEADER,
      monzo({ id: 'tx_p1', date: '01/11/2026', type: 'Pot transfer', name: 'Holiday pot', amount: '-50.00' }),
      monzo({ id: 'tx_p2', date: '02/11/2026', type: 'Pot transfer', name: 'Holiday pot', amount: '20.00' }),
      monzo({ id: 'tx_s', date: '03/11/2026', name: 'Larder & Leaf', amount: '-5.00' }),
    ], MONZO_MAPPING);
    expect(read.rows.map((r) => r.bankId)).toEqual(['tx_s']);
    expect(read.left).toEqual({ moneyIn: 0, unreadable: 0, pots: 2 });
  });

  it('IMP-1: money in, a zero (a card check) and an unreadable row are left out and counted', () => {
    const { readRows, MONZO_MAPPING } = core();
    const read = readRows([
      MONZO_HEADER,
      monzo({ id: 'tx_in1', date: '01/11/2026', name: 'Refund from shop', amount: '12.00' }),
      monzo({ id: 'tx_in2', date: '02/11/2026', type: 'Faster payment', name: 'Example Employer Ltd', amount: '1500.00' }),
      monzo({ id: 'tx_zero', date: '03/11/2026', type: 'Active card check', name: 'Example Store', amount: '0.00' }),
      monzo({ id: 'tx_bad', date: '32/11/2026', name: 'Larder & Leaf', amount: '-5.00' }),
      monzo({ id: 'tx_ok', date: '04/11/2026', name: 'Larder & Leaf', amount: '-5.00' }),
    ], MONZO_MAPPING);
    expect(read.rows.map((r) => r.bankId)).toEqual(['tx_ok']);
    expect(read.left.pots).toBe(0);
    expect(read.left.moneyIn).toBeGreaterThanOrEqual(2);
    expect(read.left.unreadable).toBeGreaterThanOrEqual(1);
    expect(read.left.moneyIn + read.left.unreadable).toBe(4);
  });

  it('IMP-1: paid in another currency: the note reads "Paid €89.99" from Local amount; pounds otherwise no note', () => {
    const { readRows, MONZO_MAPPING } = core();
    const read = readRows([
      MONZO_HEADER,
      monzo({ id: 'tx_eur', date: '07/11/2026', name: 'Café Lumière', amount: '-78.42', local: '-89.99', currency: 'EUR' }),
      monzo({ id: 'tx_gbp', date: '07/11/2026', name: 'Larder & Leaf', amount: '-3.00' }),
    ], MONZO_MAPPING);
    expect(read.rows.map((r) => [r.bankId, r.amount, r.note])).toEqual([['tx_eur', 7842, 'Paid €89.99'], ['tx_gbp', 300, null]]);
  });

  it('IMP-1: the category hint is Monzo’s category as written; none when blank', () => {
    const { readRows, MONZO_MAPPING } = core();
    const read = readRows([
      MONZO_HEADER,
      monzo({ id: 'tx_1', date: '01/11/2026', name: 'Larder & Leaf', amount: '-1.00', category: 'Groceries' }),
      monzo({ id: 'tx_2', date: '01/11/2026', name: 'Larder & Leaf', amount: '-1.00', category: '' }),
    ], MONZO_MAPPING);
    expect(read.rows.map((r) => r.categoryHint)).toEqual(['Groceries', null]);
  });

  it('IMP-1: columns found by name in any order and case, so a reordered export reads the same', () => {
    const { readRows, MONZO_MAPPING } = core();
    const rows = [monzo({ id: 'tx_1', date: '02/11/2026', name: 'Larder & Leaf', amount: '-42.50', category: 'Groceries' })];
    const order = MONZO_HEADER.map((_, i) => i).reverse();
    const shuffled = [order.map((i) => (MONZO_HEADER[i] ?? '').toLowerCase()), ...rows.map((r) => order.map((i) => r[i] ?? ''))];
    expect(readRows(shuffled, MONZO_MAPPING)).toEqual(readRows([MONZO_HEADER, ...rows], MONZO_MAPPING));
  });
});

// ─────────────────────────────── readRows: a mapped file ───────────────────────────────

const SIGNED: ColumnMapping = { date: 0, description: 1, amount: 2, spending: 'negative', bankId: 3, moneyOut: null, moneyIn: null, dateFormat: 'dd/mm/yyyy' };

describe('readRows with a column mapping (IMP-1)', () => {
  it('IMP-1: the generic fixture: three spending rows; one payment in and one impossible date left out', () => {
    const { parseCsv, readRows } = core();
    const read = readRows(parseCsv(fixture('bank-generic.csv')), SIGNED);
    expect(read.rows).toEqual([
      { bankId: 'R0001', date: '2026-11-03', description: 'Corner Bakery', amount: 420, categoryHint: null, note: null },
      { bankId: 'R0003', date: '2026-11-05', description: 'Books, Maps & More', amount: 1500, categoryHint: null, note: null },
      { bankId: 'R0004', date: '2026-11-06', description: 'Corner Bakery', amount: 420, categoryHint: null, note: null },
    ]);
    expect(read.left).toEqual({ moneyIn: 1, unreadable: 1, pots: 0 });
  });

  it('IMP-1: each date format, with d/m/yy forms for the chosen order', () => {
    const { readRows } = core();
    const dates = (format: DateFormat, cells: string[]) =>
      readRows([['When', 'What', 'Amount'], ...cells.map((d) => [d, 'Shop', '-1.00'])], { ...SIGNED, bankId: null, dateFormat: format }).rows.map((r) => r.date);
    expect(dates('dd/mm/yyyy', ['03/11/2026', '3/11/26', '29/02/2028'])).toEqual(['2026-11-03', '2026-11-03', '2028-02-29']);
    expect(dates('yyyy-mm-dd', ['2026-11-03', '2025-12-31'])).toEqual(['2026-11-03', '2025-12-31']);
    expect(dates('mm/dd/yyyy', ['11/03/2026', '11/3/26', '12/31/2025'])).toEqual(['2026-11-03', '2026-11-03', '2025-12-31']);
  });

  it('IMP-1: a date that isn’t one, in the chosen format, is unreadable', () => {
    const { readRows } = core();
    const read = readRows(
      [['When', 'What', 'Amount'], ['31/02/2026', 'Shop', '-1.00'], ['13/13/2026', 'Shop', '-1.00'], ['2026-11-03', 'Shop', '-1.00'], ['', 'Shop', '-1.00'], ['03/11/2026', 'Shop', '-1.00']],
      { ...SIGNED, bankId: null, dateFormat: 'dd/mm/yyyy' },
    );
    expect(read.rows.map((r) => r.date)).toEqual(['2026-11-03']);
    expect(read.left).toEqual({ moneyIn: 0, unreadable: 4, pots: 0 });
  });

  it('IMP-1: amounts by parseAmount’s rules: commas as thousands, £ and spaces ignored, more than two decimals refused', () => {
    const { readRows } = core();
    const read = readRows(
      [['When', 'What', 'Amount'], ['03/11/2026', 'A', '-£1,234.56'], ['03/11/2026', 'B', ' -12.5 '], ['03/11/2026', 'C', '-12.505'], ['03/11/2026', 'D', 'about a tenner'], ['03/11/2026', 'E', '-7']],
      { ...SIGNED, bankId: null },
    );
    expect(read.rows.map((r) => [r.description, r.amount])).toEqual([['A', 123456], ['B', 1250], ['E', 700]]);
    expect(read.left).toEqual({ moneyIn: 0, unreadable: 2, pots: 0 });
  });

  it('IMP-1: one signed column, spending shown as negative', () => {
    const { readRows } = core();
    const read = readRows([['When', 'What', 'Amount'], ['03/11/2026', 'Shop', '-12.50'], ['03/11/2026', 'Wages', '12.50']], { ...SIGNED, bankId: null, spending: 'negative' });
    expect(read.rows.map((r) => [r.description, r.amount])).toEqual([['Shop', 1250]]);
    expect(read.left.moneyIn).toBe(1);
  });

  it('IMP-1: one signed column, spending shown as positive', () => {
    const { readRows } = core();
    const read = readRows([['When', 'What', 'Amount'], ['03/11/2026', 'Shop', '12.50'], ['03/11/2026', 'Refund', '-12.50']], { ...SIGNED, bankId: null, spending: 'positive' });
    expect(read.rows.map((r) => [r.description, r.amount])).toEqual([['Shop', 1250]]);
    expect(read.left.moneyIn).toBe(1);
  });

  it('IMP-1: Money out and Money in columns: out is spending (by its size), in is a payment in', () => {
    const { readRows } = core();
    const mapping: ColumnMapping = { date: 0, description: 1, amount: null, spending: 'negative', moneyOut: 2, moneyIn: 3, bankId: null, dateFormat: 'yyyy-mm-dd' };
    const read = readRows([
      ['Date', 'Description', 'Money out', 'Money in', 'Balance'],
      ['2026-11-03', 'Shop', '12.50', '', '100.00'],
      ['2026-11-03', 'Signed shop', '-4.00', '', '96.00'],
      ['2026-11-04', 'Wages', '', '2,000.00', '2096.00'],
      ['2026-11-05', 'Nothing at all', '', '', '2096.00'],
    ], mapping);
    expect(read.rows.map((r) => [r.description, r.amount])).toEqual([['Shop', 1250], ['Signed shop', 400]]);
    expect(read.left.moneyIn).toBeGreaterThanOrEqual(1);
    expect(read.left.moneyIn + read.left.unreadable).toBe(2);
  });

  it('IMP-1: a ragged row missing its amount is unreadable, not a crash', () => {
    const read = core().readRows([['When', 'What', 'Amount'], ['03/11/2026', 'Shop'], ['03/11/2026', 'Shop', '-1.00']], { ...SIGNED, bankId: null });
    expect(read.rows).toHaveLength(1);
    expect(read.left.unreadable).toBe(1);
  });

  describe('without a bank id column, ids are made from the row (IMP-1, IMP-3)', () => {
    const table = [
      ['When', 'What', 'Amount'],
      ['03/11/2026', 'Corner Bakery', '-4.20'],
      ['03/11/2026', 'Corner Bakery', '-4.20'],
      ['03/11/2026', 'Corner Bakery', '-4.21'],
      ['04/11/2026', 'Corner Bakery', '-4.20'],
      ['03/11/2026', 'Corner Cafe', '-4.20'],
    ];
    const mapping: ColumnMapping = { ...SIGNED, bankId: null };

    it('IMP-3: "gen:" ids, the same on every read of the same file', () => {
      const { readRows } = core();
      const first = readRows(table, mapping).rows.map((r) => r.bankId);
      expect(first).toHaveLength(5);
      for (const id of first) expect(id).toMatch(/^gen:.+/);
      expect(readRows(structuredClone(table), mapping).rows.map((r) => r.bankId)).toEqual(first);
    });

    it('IMP-3: identical rows (same date, amount, description) get different ids; any difference gives a different id', () => {
      const ids = core().readRows(table, mapping).rows.map((r) => r.bankId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('IMP-3: an id depends on position among identical rows only, so a longer export still matches itself', () => {
      const { readRows } = core();
      const before = readRows(table, mapping).rows.map((r) => r.bankId);
      const longer = [table[0] ?? [], ['01/11/2026', 'Earlier shop', '-9.99'], ...table.slice(1), ['20/11/2026', 'Later shop', '-1.00']];
      const after = readRows(longer, mapping).rows.map((r) => r.bankId);
      expect(after.slice(1, 6)).toEqual(before);
    });
  });
});

// ─────────────────────────────── exportCsv ───────────────────────────────

const JAE: UserId = '00000000-0000-4000-8000-0000000000a1';
const SAM: UserId = '00000000-0000-4000-8000-0000000000b1';
const PEOPLE: readonly [Named, Named] = [{ id: JAE, name: 'Jae' }, { id: SAM, name: 'Sam' }];
const CATEGORIES: Named[] = [{ id: 'cat-groceries', name: 'Groceries' }, { id: 'cat-eating', name: 'Eating out' }];
const CHAPTERS: Named[] = [{ id: 'ch-japan', name: 'Japan' }];
let seq = 0;
function entry(description: string, amount: number, over: Partial<ExportEntry> & { by?: UserId } = {}): ExportEntry {
  const { by = JAE, ...rest } = over;
  seq += 1;
  const half = Math.floor(amount / 2);
  const other = by === JAE ? SAM : JAE;
  return {
    id: `e${String(seq)}`, kind: 'expense', description, amount: pence(amount), paid: { [by]: pence(amount), [other]: pence(0) },
    shares: { [by]: pence(amount - half), [other]: pence(half) }, splitMode: 'ratio', date: '2026-10-10', categoryId: 'cat-groceries',
    chapterId: null, country: 'GB', recurringId: null, deleted: false, notes: null, ...rest,
  };
}
function settleUp(amount: number, date: IsoDate, from: UserId = SAM, over: Partial<ExportSettlement> = {}): ExportSettlement {
  seq += 1;
  return { id: `s${String(seq)}`, from, to: from === JAE ? SAM : JAE, amount: pence(amount), date, deleted: false, note: null, ...over };
}
const HEADER = ['Date', 'Type', 'Description', 'Category', 'Chapter', 'Country', 'Amount', 'Paid by', 'Jae\'s share', 'Sam\'s share', 'Notes', 'Deleted'];
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const col = (name: string) => HEADER.indexOf(name);

function exported(entries: ExportEntry[], settlements: ExportSettlement[] = [], range = OCTOBER) {
  const { exportCsv, parseCsv } = core();
  const text = exportCsv(entries, settlements, PEOPLE, CATEGORIES, CHAPTERS, range);
  const table = parseCsv(text);
  const rows = table.slice(1);
  const find = (description: string) => rows.find((r) => r[col('Description')] === description);
  return { text, table, rows, find };
}

describe('exportCsv: entries and settle-ups for a range (EXP-1, OFF-3)', () => {
  it('EXP-1: the columns, with each person’s share named', () => {
    expect(exported([]).table[0]).toEqual(HEADER);
  });

  it('EXP-1: an expense: ISO date, type, names for category and chapter, plain pounds, who paid, each share, notes', () => {
    const { find } = exported([
      entry('Sushi', 8801, { categoryId: 'cat-eating', chapterId: 'ch-japan', country: 'JP', date: '2026-10-06', notes: 'Birthday' }),
      entry('Weekly shop', 4250, { by: SAM, categoryId: null }),
    ]);
    const sushi = find('Sushi');
    expect(sushi?.[col('Date')]).toBe('2026-10-06');
    expect(sushi?.[col('Type')]).toBe('Expense');
    expect(sushi?.[col('Category')]).toBe('Eating out');
    expect(sushi?.[col('Chapter')]).toBe('Japan');
    expect(sushi?.[col('Amount')]).toBe('88.01');
    expect(sushi?.[col('Paid by')]).toBe('Jae');
    expect(sushi?.[col('Jae\'s share')]).toBe('44.01');
    expect(sushi?.[col('Sam\'s share')]).toBe('44.00');
    expect(sushi?.[col('Notes')]).toBe('Birthday');
    expect(sushi?.[col('Deleted')]).toBe('');
    const shop = find('Weekly shop');
    expect(shop?.[col('Category')]).toBe('');
    expect(shop?.[col('Chapter')]).toBe('');
    expect(shop?.[col('Paid by')]).toBe('Sam');
    expect(shop?.[col('Amount')]).toBe('42.50');
  });

  it('EXP-1: money back and settle-ups have their own type', () => {
    const { find, rows } = exported(
      [entry('Refund for the lamp', 1000, { kind: 'money_back' })],
      [settleUp(2200, '2026-10-20')],
    );
    expect(find('Refund for the lamp')?.[col('Type')]).toBe('Money back');
    expect(find('Refund for the lamp')?.[col('Amount')]).toBe('10.00');
    const settle = rows.filter((r) => r[col('Type')] === 'Settle-up');
    expect(settle).toHaveLength(1);
    expect(settle[0]?.[col('Date')]).toBe('2026-10-20');
    expect(settle[0]?.[col('Amount')]).toBe('22.00');
    expect(settle[0]?.[col('Paid by')]).toBe('Sam');
  });

  it('EXP-1: a for-the-other entry shows a share of 0.00', () => {
    const { find } = exported([{ ...entry('Haircut', 3000), splitMode: 'for_other', shares: { [JAE]: pence(0), [SAM]: pence(3000) } }]);
    expect(find('Haircut')?.[col('Jae\'s share')]).toBe('0.00');
    expect(find('Haircut')?.[col('Sam\'s share')]).toBe('30.00');
  });

  it('EXP-1: deleted entries and settle-ups are included and marked', () => {
    const { find, rows } = exported([entry('Pizza', 3000, { deleted: true })], [settleUp(500, '2026-10-21', SAM, { deleted: true })]);
    expect(find('Pizza')?.[col('Deleted')]).toBe('yes');
    expect(rows.find((r) => r[col('Type')] === 'Settle-up')?.[col('Deleted')]).toBe('yes');
  });

  it('EXP-1: the range is inclusive at both ends; nothing outside it', () => {
    const { rows } = exported(
      [entry('Day before', 100, { date: '2026-09-30' }), entry('First day', 100, { date: '2026-10-01' }), entry('Last day', 100, { date: '2026-10-31' }), entry('Day after', 100, { date: '2026-11-01' })],
      [settleUp(100, '2026-09-30'), settleUp(200, '2026-10-31'), settleUp(300, '2026-11-01')],
    );
    expect(rows.filter((r) => r[col('Type')] !== 'Settle-up').map((r) => r[col('Description')]).sort()).toEqual(['First day', 'Last day']);
    expect(rows.filter((r) => r[col('Type')] === 'Settle-up').map((r) => r[col('Amount')])).toEqual(['2.00']);
  });

  it('EXP-1: UTF-8 with a BOM, CRLF line endings', () => {
    const { text } = exported([entry('이마트', 1200), entry('Café', 300, { notes: 'naïve “quotes”' })]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(text.replace(/\r\n/g, '').includes('\r')).toBe(false);
    expect(text).toContain('이마트');
  });

  it('EXP-1: a cell that a spreadsheet would run as a formula starts with an apostrophe', () => {
    const { find } = exported([
      entry('=HYPERLINK("http://example.invalid","x")', 100),
      entry('+44 call', 100), entry('-5 off', 100), entry('@home', 100), entry('\tTabbed', 100), entry('Plain', 100, { notes: '=1+1' }),
    ]);
    expect(find('\'=HYPERLINK("http://example.invalid","x")')).toBeDefined();
    expect(find('\'+44 call')).toBeDefined();
    expect(find('\'-5 off')).toBeDefined();
    expect(find('\'@home')).toBeDefined();
    expect(find('\'\tTabbed')).toBeDefined();
    expect(find('Plain')?.[col('Notes')]).toBe('\'=1+1');
  });

  it('EXP-1: commas, quotes and line breaks in a description survive', () => {
    const { find } = exported([entry('Noodle Bar, Soho', 1820, { notes: 'He said "two"\r\nthen three' })]);
    expect(find('Noodle Bar, Soho')?.[col('Notes')]).toBe('He said "two"\r\nthen three');
  });
});

describe('csvCell (EXP-1)', () => {
  it('EXP-1: plain text as it is; quoting when needed; formula prefix', () => {
    const { csvCell } = core();
    expect(csvCell('Tesco')).toBe('Tesco');
    expect(csvCell('42.50')).toBe('42.50');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1:A2)')).toBe('\'=SUM(A1:A2)');
    expect(csvCell('-3')).toBe('\'-3');
    expect(csvCell('')).toBe('');
  });
});

// ─────────────────────────────── properties ───────────────────────────────

const CHARS = ['a', 'Z', '1', ' ', ',', '"', '\n', '\r', '=', '+', '-', '@', '\t', '£', '이', '\'', '.', 'é'];
const cellArb = fc.string({ unit: fc.constantFrom(...CHARS), maxLength: 12 });

describe('properties (EXP-1, IMP-1)', () => {
  it('EXP-1 IMP-1: parseCsv of a row built with csvCell gives the cells back (formula cells with their apostrophe)', () => {
    const { csvCell, parseCsv } = core();
    fc.assert(fc.property(fc.array(cellArb, { minLength: 2, maxLength: 6 }), (cells) => {
      const line = `${cells.map(csvCell).join(',')}\r\n`;
      const expected = cells.map((c) => (/^[=+\-@\t\r]/.test(c) ? `'${c}` : c));
      expect(parseCsv(line)).toEqual([expected]);
    }), { numRuns: 300 });
  });

  it('EXP-1: export round trip: every amount and share parses back to the same pence', () => {
    const { exportCsv, parseCsv } = core();
    const entryArb = fc.record({
      amount: fc.integer({ min: 1, max: 100_000_000 }),
      jaeShare: fc.integer({ min: 0, max: 100 }),
      byJae: fc.boolean(),
      moneyBack: fc.boolean(),
      deleted: fc.boolean(),
      day: fc.integer({ min: 0, max: 30 }),
      description: cellArb,
    });
    fc.assert(fc.property(fc.array(entryArb, { maxLength: 12 }), (raw) => {
      const entries = raw.map((r, i) => {
        const jae = Math.floor((r.amount * r.jaeShare) / 100);
        const by = r.byJae ? JAE : SAM;
        return {
          ...entry(`${r.description}#${String(i)}`, r.amount, { by, kind: r.moneyBack ? 'money_back' : 'expense', deleted: r.deleted, date: addDays('2026-10-01', r.day) }),
          shares: { [JAE]: pence(jae), [SAM]: pence(r.amount - jae) },
        } satisfies ExportEntry;
      });
      const rows = parseCsv(exportCsv(entries, [], PEOPLE, CATEGORIES, CHAPTERS, OCTOBER)).slice(1);
      expect(rows).toHaveLength(entries.length);
      const money = (cell: string | undefined) => (cell === '0.00' ? 0 : parseAmount(cell ?? ''));
      for (const [i, e] of entries.entries()) {
        const row = rows.find((r) => (r[col('Description')] ?? '').endsWith(`#${String(i)}`));
        expect(row).toBeDefined();
        expect(money(row?.[col('Amount')])).toBe(e.amount);
        expect(money(row?.[col('Jae\'s share')])).toBe(e.shares[JAE]);
        expect(money(row?.[col('Sam\'s share')])).toBe(e.shares[SAM]);
      }
    }), { numRuns: 150 });
  });
});

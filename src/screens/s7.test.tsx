/**
 * S7 screens (docs/slices/S7.md "Decisions made here", "Interfaces", "Tests → Screens"; SPEC IMP-1, IMP-3, EXP-1, EXP-3,
 * INB-1, OFF-3): Settings → "Import from a bank statement" and its "Import a statement" dialog, the Inbox's import
 * cards, Settings → "Export" ("Entries as CSV", "Monthly statement"), the statement page, Settings → "Restore from a
 * backup", "Import rules" and "Storage", on the real screens over the in-memory Api. Written before the build
 * (ENGINEERING §5, tests first by someone else). The layout half (320/390 px, both themes, axe, print) is
 * tests/e2e/s7.spec.ts.
 *
 * What these tests read (the brief's Interfaces):
 *   Settings: regions "Import from a bank statement" (file input labelled "Choose a CSV file"), "Export" (buttons
 *     "Entries as CSV", "Monthly statement"), "Restore from a backup" (file input labelled "Choose a backup file"),
 *     "Import rules", "Storage".
 *   Import: dialog "Import a statement"; for Monzo the line "Monzo statement" and a summary status; otherwise selects
 *     "Date column", "Description column", "Amount column", "Money out column", "Money in column", "Bank id column",
 *     "Date format", radio group "Spending is shown as"; a date field "From"; button "Import N rows"; "Nothing new in
 *     this file" when none.
 *   Inbox import card: an article with the description, amount, date, "Paid by ⟨name⟩"; buttons "Keep", "Change first",
 *     "Not ours"; checkbox "Always do this for ⟨description⟩"; button "Stop reviewing".
 *   Export: dialog "Entries as CSV" with date fields "From", "To" and button "Download".
 *   Statement: /statement/YYYY-MM, heading "Statement for ⟨Month YYYY⟩", table "Entries", lines "Balance at the start"
 *     and "Balance at the end", button "Save as PDF".
 *   Restore: dialog "Restore from a backup" with the summary status, "⟨backup name⟩ is" selects, "Swap", "Restore".
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - The selects' options are labelled with the file's header names ("Posted", "Details", …; "None" or similar for
 *     an optional column) and the date formats as written ("dd/mm/yyyy", "yyyy-mm-dd", "mm/dd/yyyy"); the radios of
 *     "Spending is shown as" contain the words "negative" and "positive". Tests pick options by their visible text.
 *   - The summary status names what was left out as the brief writes it ("1 payment in … left out", "1 unreadable row")
 *     and the rules' share ("Your rules will keep 1 and skip 1").
 *   - "Too big" is shown as the sentence "That file is too big. Export a shorter period." anywhere on the page.
 *   - Downloads go through URL.createObjectURL(blob) and an <a download="…"> click, as "Download a backup" already does.
 *   - Storage figures come from the Api's `storageUsed()` (the storage_used RPC), answering
 *     { database_bytes: number, photo_bytes: number }; the tests replace that one Api method. MB may be 10^6 or 2^20
 *     bytes (the tests accept either, rounded or not).
 *   - The statement's balance lines use the app's balance words ("Sam owes Jae £25.00", "All square").
 *   - Restoring reaches the Api as `restoreBackup(people, rows)` (memoryApi records 'restoreBackup' with { people, rows }).
 *   - The import queue lives in idb-keyval (mocked here with tests/fixtures/fake-idb-keyval.ts).
 *
 * The household on Sat 14 Nov 2026 (TODAY): Jae (signed in, the importer) and Sam, 50/50.
 * tests/fixtures/monzo-sample.csv (all November): Larder & Leaf £42.50 (2 Nov, Groceries), a pot transfer, a payment in,
 * "Noodle Bar, Soho" £18.20 (5 Nov, Eating out), Café Lumière £78.42 (7 Nov, paid €89.99), Metro Ticket Machine £2.80
 * (9 Nov, Transport), and a row with no Name, "HARDWARE CORNER, EXAMPLETOWN" £12.00 (10 Nov, Shopping).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, storedInboxItem, storedSettlement,
} from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { backupJson, DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import type { Database } from '../data/database.types';
import type { MemoryTables } from '../data/memoryApi';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ImportRuleRow = Database['public']['Tables']['import_rules']['Row'];
type ImportIgnoreRow = Database['public']['Tables']['import_ignores']['Row'];
type S7Tables = MemoryTables & { importIgnores?: ImportIgnoreRow[]; importRules?: ImportRuleRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S7Tables;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8');
const MONZO_CSV = fixture('monzo-sample.csv');
const GENERIC_CSV = fixture('bank-generic.csv');
const LARDER_ID = 'tx_0000TESTSAMPLE0001';
const NOODLE_ID = 'tx_0000TESTSAMPLE0004';
const CAFE_ID = 'tx_0000TESTSAMPLE0005';
const METRO_ID = 'tx_0000TESTSAMPLE0006';
const HARDWARE_ID = 'tx_0000TESTSAMPLE0007';

// ───────── the app ─────────
let open: DataLayer[] = [];
const blobs: Blob[] = [];
const downloads: string[] = [];
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
  idbData.clear();
  blobs.length = 0;
  downloads.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { if (b instanceof Blob) blobs.push(b); return 'blob:smsm-test/file'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { if (this.download) downloads.push(this.download); });
  // A file input opened by the app (its picker) is not opened.
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const l of open.splice(0)) await l.dispose();
  open = [];
});

function rule(over: Partial<ImportRuleRow> & Pick<ImportRuleRow, 'match_text' | 'decision'>): ImportRuleRow {
  return { id: crypto.randomUUID(), household_id: HID, category_id: null, split_mode: null, split_params: null, created_at: '2026-11-01T12:00:00.000Z', ...over };
}
let n = 0;
function imported(bankId: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  n += 1;
  return storedExpense({ id: `00000000-0000-4000-8000-0000000f${n.toString(16).padStart(4, '0')}`, description: 'Kept before', source: 'monzo', external_id: bankId, ...over });
}
/** A household with import ignores and rules on the "server" too. */
function household(opts: Parameters<typeof couple>[0] & { ignores?: ImportIgnoreRow[]; rules?: ImportRuleRow[] } = {}) {
  const { ignores = [], rules = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = tablesOf(c);
  t.importIgnores ??= [];
  t.importIgnores.push(...ignores);
  t.importRules ??= [];
  t.importRules.push(...rules);
  return c;
}
function show(layer: DataLayer) {
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
function launchAt(path: string, layer: DataLayer) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
  return show(layer);
}
function at(path: string) {
  act(() => {
    history.replaceState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    resetHistoryForTests();
  });
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
const toasts = () => screen.getByRole('status', { name: 'Notifications', hidden: true });
function offline(c: ReturnType<typeof household>) {
  act(() => { c.network.set(false); });
  c.controls.online = false;
}

async function goSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { level: 1, name: 'Settings' });
}
async function region(name: string) {
  return screen.findByRole('region', { name });
}
function choose(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}
const csvFile = (body: string, name = 'statement.csv') => new File([body], name, { type: 'text/csv' });
async function importDialogFor(body: string, name?: string) {
  await goSettings();
  const r = await region('Import from a bank statement');
  choose(within(r).getByLabelText('Choose a CSV file'), csvFile(body, name));
  return screen.findByRole('dialog', { name: 'Import a statement' });
}
async function importMonzo(c: ReturnType<typeof household>, body = MONZO_CSV) {
  const dialog = await importDialogFor(body);
  const go = await within(dialog).findByRole('button', { name: /^Import \d+ rows?$/ });
  fireEvent.click(go);
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Import a statement' })).toBeNull(); });
  await settle(c.layer);
}
/** The Inbox page, from wherever the import left us. */
async function openInbox(count?: number) {
  if (!screen.queryByRole('heading', { level: 1, name: 'Inbox' })) {
    at('/');
    const name = count === undefined ? /^Inbox\W+\d+/ : new RegExp(`^Inbox\\W+${String(count)}(\\D|$)`);
    fireEvent.click(await screen.findByRole('button', { name }));
  }
  await screen.findByRole('heading', { level: 1, name: 'Inbox' });
  return screen.getByRole('main');
}
async function card(description: string) {
  const main = screen.getByRole('main');
  await waitFor(() => { expect(within(main).getAllByRole('article').some((a) => text(a).includes(description))).toBe(true); });
  const found = within(main).getAllByRole('article').find((a) => text(a).includes(description));
  if (!found) throw new Error(`no card for ${description}`);
  return found;
}
function pick(select: HTMLElement, label: string | RegExp) {
  const options = Array.from((select as HTMLSelectElement).options);
  const option = options.find((o) => (typeof label === 'string' ? o.textContent.trim() === label : label.test(o.textContent)));
  if (!option) throw new Error(`no option ${String(label)} in ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.change(select, { target: { value: option.value } });
}
const selected = (select: HTMLElement) => (select as HTMLSelectElement).selectedOptions[0]?.textContent.trim() ?? '';
const statusText = (scope: HTMLElement) => within(scope).queryAllByRole('status').map(text).join(' ');

// ─────────────────────────────── IMP-1: the Import dialog ───────────────────────────────

describe('Settings → "Import from a bank statement" (IMP-1, OFF-3)', () => {
  it('IMP-1: a Monzo file is recognised; the summary says what was left out; "Import 5 rows" turns them into Inbox cards', async () => {
    const c = household();
    show(c.layer);
    const dialog = await importDialogFor(MONZO_CSV);
    expect(within(dialog).getByText('Monzo statement')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: 'Date column' })).toBeNull();
    await waitFor(() => { expect(statusText(dialog)).toMatch(/1 payment in\b/); });
    expect(statusText(dialog)).toMatch(/left out/);
    expect(within(dialog).getByLabelText('From')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 5 rows' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Import a statement' })).toBeNull(); });
    await settle(c.layer);
    // IMP-1: read on the phone; the rows being reviewed never reach the database (INB-1).
    expect(c.controls.tables.expenses).toEqual([]);
    expect(JSON.stringify(c.controls.calls)).not.toContain('Larder');
    expect(JSON.stringify(c.controls.calls)).not.toContain(LARDER_ID);
    await openInbox(5);
  });

  it('IMP-1: the From date leaves out what came before it', async () => {
    const c = household();
    show(c.layer);
    const dialog = await importDialogFor(MONZO_CSV);
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-11-07' } });
    expect(await within(dialog).findByRole('button', { name: 'Import 3 rows' })).toBeTruthy();
  });

  it('IMP-1: another bank’s file goes to the mapping step; mapped, it imports with the bank’s own ids', async () => {
    const c = household();
    show(c.layer);
    const dialog = await importDialogFor(GENERIC_CSV, 'bank.csv');
    expect(within(dialog).queryByText('Monzo statement')).toBeNull();
    pick(within(dialog).getByRole('combobox', { name: 'Date column' }), 'Posted');
    pick(within(dialog).getByRole('combobox', { name: 'Description column' }), 'Details');
    pick(within(dialog).getByRole('combobox', { name: 'Amount column' }), 'Value');
    pick(within(dialog).getByRole('combobox', { name: 'Bank id column' }), 'Reference');
    pick(within(dialog).getByRole('combobox', { name: 'Date format' }), 'dd/mm/yyyy');
    const spending = within(dialog).getByRole('radiogroup', { name: 'Spending is shown as' });
    fireEvent.click(within(spending).getByRole('radio', { name: /negative/i }));
    const go = await within(dialog).findByRole('button', { name: 'Import 3 rows' });
    expect(statusText(dialog)).toMatch(/1 payment in\b/);
    expect(statusText(dialog)).toMatch(/1 unreadable row\b/);
    fireEvent.click(go);
    await settle(c.layer);
    await openInbox(3);
    fireEvent.click(within(await card('Corner Bakery')).getByRole('button', { name: 'Keep' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({ description: 'Corner Bakery', amount_pence: 420, date: '2026-11-03', source: 'csv', external_id: 'R0001' });
  });

  it('IMP-1: the mapping step has every choice the brief lists', async () => {
    const c = household();
    show(c.layer);
    const dialog = await importDialogFor(GENERIC_CSV, 'bank.csv');
    for (const name of ['Date column', 'Description column', 'Amount column', 'Bank id column', 'Date format']) {
      expect(within(dialog).getByRole('combobox', { name }), name).toBeTruthy();
    }
    // Money out + Money in instead of one Amount column (they may appear once Amount is set to none).
    const amount = within(dialog).getByRole('combobox', { name: 'Amount column' });
    const none = Array.from((amount as HTMLSelectElement).options).find((o) => !['Posted', 'Details', 'Value', 'Reference'].includes(o.textContent.trim()));
    if (none) fireEvent.change(amount, { target: { value: none.value } });
    expect(await within(dialog).findByRole('combobox', { name: 'Money out column' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Money in column' })).toBeTruthy();
    const formats = Array.from(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Date format' }).options).map((o) => o.textContent.trim());
    expect(formats).toEqual(expect.arrayContaining(['dd/mm/yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy']));
    expect(selected(within(dialog).getByRole('combobox', { name: 'Date format' }))).toBe('dd/mm/yyyy');
  });

  it('IMP-1: a file that is too big is refused in plain words', async () => {
    const c = household();
    show(c.layer);
    await goSettings();
    const r = await region('Import from a bank statement');
    choose(within(r).getByLabelText('Choose a CSV file'), csvFile(`${'x'.repeat(6_000_000)}\n`));
    expect(await screen.findByText('That file is too big. Export a shorter period.')).toBeTruthy();
  });

  it('IMP-1: so is one with more than 20,000 rows', async () => {
    const c = household();
    show(c.layer);
    await goSettings();
    const r = await region('Import from a bank statement');
    choose(within(r).getByLabelText('Choose a CSV file'), csvFile(`a,b\n${'1,2\n'.repeat(20_050)}`));
    expect(await screen.findByText('That file is too big. Export a shorter period.')).toBeTruthy();
  });

  it('IMP-3: a file with nothing new says so', async () => {
    const c = household({
      expenses: [imported(LARDER_ID), imported(NOODLE_ID, { deleted_at: '2026-11-06T10:00:00.000Z' }), imported(CAFE_ID)],
      ignores: [METRO_ID, HARDWARE_ID].map((id) => ({ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${id}`) })),
    });
    show(c.layer);
    const dialog = await importDialogFor(MONZO_CSV);
    expect(await within(dialog).findByText('Nothing new in this file')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Import [1-9]\d* rows?$/ })).toBeNull();
  });

  it('IMP-3: the summary says what the household’s rules will do, and Import N counts the rows a rule keeps', async () => {
    const c = household({
      rules: [
        rule({ match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'treat' }),
        rule({ match_text: 'noodle bar, soho', decision: 'skip' }),
      ],
    });
    show(c.layer);
    const dialog = await importDialogFor(MONZO_CSV);
    await waitFor(() => { expect(statusText(dialog)).toContain('Your rules will keep 1 and skip 1'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 4 rows' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({ description: 'Metro Ticket Machine', split_mode: 'treat', category_id: categoryId('Transport'), source: 'monzo', external_id: METRO_ID });
    expect(tablesOf(c).importIgnores).toEqual([{ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${NOODLE_ID}`) }]);
    await openInbox(3);
  });

  it('IMP-1 OFF-3: offline, the file is still read and its rows reach the Inbox', async () => {
    const c = household();
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    offline(c);
    await importMonzo(c);
    const main = await openInbox(5);
    expect(text(main)).toContain('Larder & Leaf');
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Keep' }));
    await waitFor(() => { expect(c.layer.waiting().length).toBeGreaterThan(0); });
    expect(c.controls.tables.expenses).toEqual([]);
  });
});

// ─────────────────────────────── IMP-3, INB-1: the Inbox's import cards ───────────────────────────────

describe('the Inbox’s import cards (IMP-3, INB-1)', () => {
  it('INB-1 IMP-3: one card at a time, in date order: description, amount, date, "Paid by Jae", the category; with its buttons', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    const main = await openInbox(5);
    expect(within(main).getAllByRole('article')).toHaveLength(1);
    const first = await card('Larder & Leaf');
    expect(text(first)).toContain('£42.50');
    expect(text(first)).toContain('2 Nov');
    expect(text(first)).toContain('Paid by Jae');
    expect(text(first)).toContain('Groceries');
    expect(text(main)).toContain('1 of 5');
    for (const name of ['Keep', 'Change first', 'Not ours']) expect(within(first).getByRole('button', { name })).toBeTruthy();
    expect(within(first).getByRole('checkbox', { name: 'Always do this for Larder & Leaf' })).toBeTruthy();
    expect(within(main).getByRole('button', { name: 'Stop reviewing' })).toBeTruthy();
    expect(text(main)).not.toContain('Noodle Bar');
  });

  it('IMP-3: Keep adds the entry at once (default split, payer the importer, source and bank id), with Undo; the next card follows', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    const main = await openInbox(5);
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Keep' }));
    await card('Noodle Bar, Soho');
    expect(text(main)).toContain('1 of 4');
    await waitFor(() => { expect(within(toasts()).getByRole('button', { name: 'Undo', hidden: true })).toBeTruthy(); });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({
      description: 'Larder & Leaf', amount_pence: 4250, date: '2026-11-02', category_id: categoryId('Groceries'), paid: { [JAE_ID]: 4250 },
      shares: { [JAE_ID]: 2125, [SAM_ID]: 2125 }, source: 'monzo', external_id: LARDER_ID, deleted_at: null,
    });
  });

  it('IMP-3: Undo after Keep takes the entry back out of the balance', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    await openInbox(5);
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Keep' }));
    await settle(c.layer);
    fireEvent.click(await within(toasts()).findByRole('button', { name: 'Undo', hidden: true }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.filter((e) => e.deleted_at === null)).toEqual([]);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 });
  });

  it('IMP-3: Not ours keeps only the hash; Undo removes it', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    await openInbox(5);
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Not ours' }));
    await card('Noodle Bar, Soho');
    await settle(c.layer);
    expect(tablesOf(c).importIgnores).toEqual([{ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${LARDER_ID}`) }]);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(JSON.stringify(c.controls.calls)).not.toContain('Larder');
    fireEvent.click(await within(toasts()).findByRole('button', { name: 'Undo', hidden: true }));
    await settle(c.layer);
    expect(tablesOf(c).importIgnores).toEqual([]);
  });

  it('IMP-3: Change first opens the Add sheet prefilled; picking Sam (a joint statement) and saving keeps it', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    await openInbox(5);
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Change first' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('42.50');
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Larder & Leaf');
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).getByRole('radio', { name: 'Sam' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({ amount_pence: 4250, paid: { [SAM_ID]: 4250 }, source: 'monzo', external_id: LARDER_ID });
    await card('Noodle Bar, Soho');
  });

  it('IMP-3: "Always do this for" with Not ours makes a skip rule; with Keep a keep rule', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    await openInbox(5);
    const larder = await card('Larder & Leaf');
    fireEvent.click(within(larder).getByRole('checkbox', { name: 'Always do this for Larder & Leaf' }));
    fireEvent.click(within(larder).getByRole('button', { name: 'Not ours' }));
    const noodle = await card('Noodle Bar, Soho');
    fireEvent.click(within(noodle).getByRole('checkbox', { name: 'Always do this for Noodle Bar, Soho' }));
    fireEvent.click(within(noodle).getByRole('button', { name: 'Keep' }));
    await card('Café Lumière');
    await settle(c.layer);
    const rules = tablesOf(c).importRules ?? [];
    expect(rules.map((r) => [r.match_text, r.decision]).sort()).toEqual([['larder & leaf', 'skip'], ['noodle bar, soho', 'keep']]);
    expect(rules.find((r) => r.decision === 'keep')).toMatchObject({ category_id: categoryId('Eating out'), split_mode: 'ratio' });
  });

  it('IMP-3: Stop reviewing forgets the rest on this phone and records nothing; the same file offers them again', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    const main = await openInbox(5);
    fireEvent.click(within(main).getByRole('button', { name: 'Stop reviewing' }));
    await waitFor(() => { expect(within(main).queryAllByRole('article')).toEqual([]); });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(tablesOf(c).importIgnores).toEqual([]);
    expect(tablesOf(c).importRules).toEqual([]);
    at('/');
    await screen.findByRole('region', { name: 'Balance' });
    await settle(c.layer);
    expect(screen.queryByRole('button', { name: /^Inbox\b/ })).toBeNull();
    const dialog = await importDialogFor(MONZO_CSV);
    expect(await within(dialog).findByRole('button', { name: 'Import 5 rows' })).toBeTruthy();
  });

  it('INB-1 INB-2: bills come first under the same counter; then the import rows', async () => {
    const c = household({ inboxItems: [storedInboxItem()] });
    show(c.layer);
    await importMonzo(c);
    const main = await openInbox(6);
    expect(text(main)).toContain('1 of 6');
    expect(within(main).getByText('Energy is due: how much was it?')).toBeTruthy();
    expect(text(main)).not.toContain('Larder & Leaf');
    fireEvent.click(within(main).getByRole('button', { name: 'Not ours' }));
    await card('Larder & Leaf');
    expect(text(main)).toContain('1 of 5');
  });

  it('IMP-3: rows already decided are never offered again: the same file twice, after a Keep and a Not ours', async () => {
    const c = household();
    show(c.layer);
    await importMonzo(c);
    await openInbox(5);
    fireEvent.click(within(await card('Larder & Leaf')).getByRole('button', { name: 'Keep' }));
    fireEvent.click(within(await card('Noodle Bar, Soho')).getByRole('button', { name: 'Not ours' }));
    await card('Café Lumière');
    await settle(c.layer);
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Stop reviewing' }));
    await settle(c.layer);
    at('/');
    const dialog = await importDialogFor(MONZO_CSV);
    expect(await within(dialog).findByRole('button', { name: 'Import 3 rows' })).toBeTruthy();
  });
});

// ─────────────────────────────── EXP-1: Export ───────────────────────────────

const OCT = (n2: number, description: string, amount: number, payer: string, date: string, over: Partial<ExpenseRow> = {}) => {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: `00000000-0000-4000-8000-0000000e${n2.toString(16).padStart(4, '0')}`, description, amount_pence: amount, date, paid: { [payer]: amount },
    shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, category_id: categoryId('Groceries'), created_at: `${date}T12:00:00.000Z`, ...over,
  });
};
/**
 * Statement month: October 2026 (worked by hand, every entry 50/50).
 *   Before: Sofa delivery £50.00 (Jae, 20 Sep) → at the start Sam owes Jae £25.00.
 *   October: Rent £1,000.00 (Jae) +500.00; Weekly shop £240.50 (Sam) −120.25; Sam paid Jae £100.00 (20 Oct) −100.00;
 *            Dishoom £125.00 (Sam) −62.50; Pizza £30.00 (Jae, deleted, not shown).
 *   At the end: Sam owes Jae £242.25. Paid: Jae £1,000.00, Sam £365.50. Shared: £682.75 each.
 *   After: Lamp £40.00 (Jae, 10 Nov).
 */
function statementHousehold() {
  return household({
    expenses: [
      OCT(1, 'Sofa delivery', 5000, JAE_ID, '2026-09-20', { category_id: categoryId('Household') }),
      OCT(2, 'Rent', 100000, JAE_ID, '2026-10-01', { category_id: categoryId('Rent & bills') }),
      OCT(3, 'Weekly shop', 24050, SAM_ID, '2026-10-10'),
      OCT(4, 'Dishoom', 12500, SAM_ID, '2026-10-12', { category_id: categoryId('Eating out') }),
      OCT(5, 'Pizza', 3000, JAE_ID, '2026-10-15', { deleted_at: '2026-10-16T09:00:00.000Z' }),
      OCT(6, 'Lamp', 4000, JAE_ID, '2026-11-10', { category_id: categoryId('Household') }),
    ],
    settlements: [storedSettlement({ amount_pence: 10000, date: '2026-10-20' })],
  });
}

describe('Settings → "Export" (EXP-1, OFF-3)', () => {
  it('EXP-1: "Entries as CSV": From and To (this month by default), then a file for that range', async () => {
    const c = statementHousehold();
    show(c.layer);
    await goSettings();
    const r = await region('Export');
    expect(within(r).getByRole('button', { name: 'Monthly statement' })).toBeTruthy();
    fireEvent.click(within(r).getByRole('button', { name: 'Entries as CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Entries as CSV' });
    const from = within(dialog).getByLabelText<HTMLInputElement>('From');
    const to = within(dialog).getByLabelText<HTMLInputElement>('To');
    expect(from.value).toBe('2026-11-01');
    expect(to.value >= '2026-11-14' && to.value <= '2026-11-30').toBe(true);
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    fireEvent.change(to, { target: { value: '2026-10-31' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => { expect(downloads).toEqual(['smsm-entries-2026-10-01-to-2026-10-31.csv']); });
    const blob = blobs.at(-1);
    if (!blob) throw new Error('nothing was downloaded');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^\uFEFF/, '');
    const lines = body.split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe('Date,Type,Description,Category,Chapter,Country,Amount,Paid by,Jae\'s share,Sam\'s share,Notes,Deleted');
    for (const s of ['Rent', 'Weekly shop', 'Dishoom', 'Pizza', 'Settle-up', '1000.00', '240.50']) expect(body, s).toContain(s);
    for (const s of ['Sofa delivery', 'Lamp']) expect(body, s).not.toContain(s);
    // Five entries (Pizza marked deleted) and the settle-up.
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.includes('Pizza'))?.endsWith(',yes')).toBe(true);
  });

  it('EXP-1 OFF-3: the CSV is made on the phone, offline too', async () => {
    const c = statementHousehold();
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    offline(c);
    await goSettings();
    fireEvent.click(within(await region('Export')).getByRole('button', { name: 'Entries as CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Entries as CSV' });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-11-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => { expect(downloads).toEqual(['smsm-entries-2026-11-01-to-2026-11-30.csv']); });
    expect(await blobs.at(-1)?.text()).toContain('Lamp');
  });
});

// ─────────────────────────────── EXP-1: the statement page ───────────────────────────────

/** The smallest element whose text has all of these. */
function lineWith(...parts: string[]): string {
  const els = Array.from(screen.getByRole('main').querySelectorAll('*')).filter((el) => parts.every((p) => text(el).includes(p)));
  const best = els.sort((a, b) => text(a).length - text(b).length)[0];
  return best ? text(best) : '';
}

describe('the statement page (EXP-1, OFF-3)', () => {
  it('EXP-1: /statement/2026-10: the names, the month, the balance at the start and the end, every row, and the totals', async () => {
    const c = statementHousehold();
    launchAt('/statement/2026-10', c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Statement for October 2026' })).toBeTruthy();
    await settle(c.layer);
    const main = screen.getByRole('main');
    expect(text(main)).toContain('Jae');
    expect(text(main)).toContain('Sam');
    expect(lineWith('Balance at the start', '£')).toContain('Sam owes Jae £25.00');
    expect(lineWith('Balance at the end', '£')).toContain('Sam owes Jae £242.25');
    const table = within(main).getByRole('table', { name: 'Entries' });
    const rows = within(table).getAllByRole('row').map(text);
    for (const s of ['Rent', 'Weekly shop', 'Dishoom']) expect(rows.some((r) => r.includes(s)), s).toBe(true);
    expect(rows.some((r) => r.includes('£100.00'))).toBe(true);
    for (const s of ['Pizza', 'Lamp', 'Sofa delivery']) expect(rows.some((r) => r.includes(s)), s).toBe(false);
    expect(rows.find((r) => r.includes('Rent'))).toContain('£1,000.00');
    expect(rows.find((r) => r.includes('Rent'))).toContain('£500.00');
    // Totals paid and shared by each person.
    expect(text(main)).toContain('£365.50');
    expect(text(main)).toContain('£682.75');
  });

  it('EXP-1: "Save as PDF" opens the phone’s print sheet', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const c = statementHousehold();
    launchAt('/statement/2026-10', c.layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('EXP-1: the current month works too; an empty month says All square at both ends', async () => {
    const c = household();
    launchAt('/statement/2026-11', c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Statement for November 2026' })).toBeTruthy();
    await settle(c.layer);
    expect(lineWith('Balance at the start', 'All square')).not.toBe('');
    expect(lineWith('Balance at the end', 'All square')).not.toBe('');
  });

  it('EXP-1 OFF-3: offline, the statement is made from the phone’s copy', async () => {
    const c = statementHousehold();
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(c.layer);
    offline(c);
    at('/statement/2026-10');
    expect(await screen.findByRole('heading', { level: 1, name: 'Statement for October 2026' })).toBeTruthy();
    expect(lineWith('Balance at the end', '£')).toContain('Sam owes Jae £242.25');
  });
});

// ─────────────────────────────── EXP-1: restoring a backup ───────────────────────────────

/** A backup of another copy of the household: 3 entries, 2 settle-ups, 2 chapters, as Download a backup writes it. */
async function backupFile(): Promise<File> {
  const chapterB = storedChapter({ id: '00000000-0000-4000-8000-00000000c402', name: 'New sofa', kind: 'project', country: null, start_date: null, end_date: null });
  const from = couple({
    expenses: [
      OCT(101, 'Old rent', 90000, JAE_ID, '2025-10-01'),
      OCT(102, 'Old shop', 3000, SAM_ID, '2025-10-02', { chapter_id: storedChapter().id }),
      OCT(103, 'Old sofa', 50000, JAE_ID, '2025-10-03', { chapter_id: chapterB.id }),
    ],
    settlements: [
      storedSettlement({ id: '00000000-0000-4000-8000-00000000f101', amount_pence: 1000, date: '2025-10-05' }),
      storedSettlement({ id: '00000000-0000-4000-8000-00000000f102', amount_pence: 2000, date: '2025-10-06' }),
    ],
    chapters: [storedChapter(), chapterB],
  });
  await from.layer.ready;
  await from.layer.idle();
  const json = backupJson({ appVersion: '0.1.0' }, from.layer);
  await from.layer.dispose();
  return new File([json], 'smsm-backup-2025-10-31.json', { type: 'application/json' });
}
const restores = (c: ReturnType<typeof household>) => c.controls.calls.filter((call) => call.name === 'restoreBackup');

describe('Settings → "Restore from a backup" (EXP-1)', () => {
  it('EXP-1: the summary; each backup person mapped by name; Swap; Restore adds the rows with the people as mapped', async () => {
    const file = await backupFile();
    const c = household();
    show(c.layer);
    await goSettings();
    choose(within(await region('Restore from a backup')).getByLabelText('Choose a backup file'), file);
    const dialog = await screen.findByRole('dialog', { name: 'Restore from a backup' });
    await waitFor(() => { expect(statusText(dialog)).toContain('Adds 3 entries, 2 settle-ups, 2 chapters.'); });
    expect(statusText(dialog)).toContain('Nothing already here changes.');
    const jae = within(dialog).getByRole('combobox', { name: 'Jae is' });
    const sam = within(dialog).getByRole('combobox', { name: 'Sam is' });
    expect([selected(jae), selected(sam)]).toEqual(['Jae', 'Sam']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Swap' }));
    expect([selected(jae), selected(sam)]).toEqual(['Sam', 'Jae']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => { expect(restores(c).length).toBeGreaterThan(0); });
    await settle(c.layer);
    expect((restores(c)[0]?.arg as { people?: unknown } | undefined)?.people).toEqual({ [JAE_ID]: SAM_ID, [SAM_ID]: JAE_ID });
    const rent = c.controls.tables.expenses.find((e) => e.description === 'Old rent');
    expect(rent).toMatchObject({ paid: { [SAM_ID]: 90000 } });
    expect(c.controls.tables.expenses).toHaveLength(3);
    expect(c.controls.tables.settlements).toHaveLength(2);
    expect(c.controls.tables.chapters).toHaveLength(2);
  });

  it('EXP-1: restoring needs a connection: offline it says so and sends nothing', async () => {
    const file = await backupFile();
    const c = household();
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    offline(c);
    await goSettings();
    choose(within(await region('Restore from a backup')).getByLabelText('Choose a backup file'), file);
    expect(await screen.findByText('Restoring needs a connection')).toBeTruthy();
    const dialog = screen.queryByRole('dialog', { name: 'Restore from a backup' });
    const restore = dialog ? within(dialog).queryByRole('button', { name: 'Restore' }) : null;
    if (restore) fireEvent.click(restore);
    await settle(c.layer);
    c.controls.online = true;
    expect(restores(c)).toEqual([]);
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('EXP-1: a file that isn’t a backup is refused and nothing is restored', async () => {
    const c = household();
    show(c.layer);
    await goSettings();
    choose(within(await region('Restore from a backup')).getByLabelText('Choose a backup file'), new File([MONZO_CSV], 'statement.csv', { type: 'text/csv' }));
    await settle(c.layer);
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull(); });
    expect(restores(c)).toEqual([]);
  });
});

// ─────────────────────────────── IMP-3: Import rules ───────────────────────────────

describe('Settings → "Import rules" (IMP-3)', () => {
  it('IMP-3: lists the rules, each with Remove', async () => {
    const skip = rule({ match_text: 'noodle bar, soho', decision: 'skip' });
    const keep = rule({ match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'ratio' });
    const c = household({ rules: [skip, keep] });
    show(c.layer);
    await goSettings();
    const r = await region('Import rules');
    await waitFor(() => { expect(within(r).getAllByRole('listitem')).toHaveLength(2); });
    const noodle = within(r).getAllByRole('listitem').find((li) => text(li).toLowerCase().includes('noodle bar, soho'));
    if (!noodle) throw new Error('no Noodle Bar rule listed');
    expect(within(r).getAllByRole('listitem').some((li) => text(li).toLowerCase().includes('metro ticket machine'))).toBe(true);
    fireEvent.click(within(noodle).getByRole('button', { name: /^Remove/ }));
    await waitFor(() => { expect(within(r).getAllByRole('listitem')).toHaveLength(1); });
    await settle(c.layer);
    expect((tablesOf(c).importRules ?? []).map((x) => x.id)).toEqual([keep.id]);
  });
});

// ─────────────────────────────── EXP-3: Storage ───────────────────────────────

const MB = [1_000_000, 1_048_576];
function figuresOk(line: string, db: number, photos: number): boolean {
  const m = /Storage: (\d+) MB of 500 MB database, (\d+) MB of 1 GB photos/.exec(line);
  if (!m) return false;
  const near = (shown: number, bytes: number) => MB.some((u) => shown === Math.round(bytes / u) || shown === Math.floor(bytes / u));
  return near(Number(m[1]), db) && near(Number(m[2]), photos);
}
function withStorage(c: ReturnType<typeof household>, db: number, photos: number) {
  Object.assign(c.layer.api, { storageUsed: () => Promise.resolve({ database_bytes: db, photo_bytes: photos }) });
}
const WARNING = 'Nearly full: export and remove old receipt photos, or move to a paid plan';

describe('Settings → "Storage" (EXP-3)', () => {
  it('EXP-3: storage used against the free plan’s limits', async () => {
    const c = household();
    withStorage(c, 12_300_000, 40_200_000);
    show(c.layer);
    await goSettings();
    const r = await region('Storage');
    await waitFor(() => { expect(figuresOk(text(r), 12_300_000, 40_200_000)).toBe(true); });
    expect(text(r)).not.toContain(WARNING);
  });

  it('EXP-3: at 80% or more of the database, a warning line', async () => {
    const c = household();
    withStorage(c, 450_000_000, 100_000_000);
    show(c.layer);
    await goSettings();
    const r = await region('Storage');
    await waitFor(() => { expect(text(r)).toContain(WARNING); });
  });

  it('EXP-3: at 80% or more of the photos, a warning line', async () => {
    const c = household();
    withStorage(c, 100_000_000, 900_000_000);
    show(c.layer);
    await goSettings();
    const r = await region('Storage');
    await waitFor(() => { expect(text(r)).toContain(WARNING); });
  });

  it('EXP-3: offline, the last figure is still shown', async () => {
    const c = household();
    withStorage(c, 12_300_000, 40_200_000);
    show(c.layer);
    await goSettings();
    await waitFor(async () => { expect(figuresOk(text(await region('Storage')), 12_300_000, 40_200_000)).toBe(true); });
    at('/');
    await screen.findByRole('region', { name: 'Balance' });
    offline(c);
    Object.assign(c.layer.api, { storageUsed: () => Promise.reject(new Error('TypeError: Failed to fetch')) });
    await goSettings();
    await waitFor(async () => { expect(figuresOk(text(await region('Storage')), 12_300_000, 40_200_000)).toBe(true); });
  });
});

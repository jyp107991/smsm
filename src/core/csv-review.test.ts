/**
 * S7 fresh-review fixes in the core (docs/slices/S7.md; SPEC IMP-1, IMP-3):
 *   5. A generated id ("gen:", for a file with no bank id column) hashes the row with 64 bits, not 32, so two
 *      different rows in years of statements don't share an id (a shared id would hide one of them).
 *   6. A statement saved by a bank in windows-1252 (not UTF-8) still reads: "£" and accented names come out right.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeCsv, readRows, type ColumnMapping } from './csv';

const MAPPING: ColumnMapping = { date: 0, description: 1, amount: 2, spending: 'negative', bankId: null, moneyOut: null, moneyIn: null, dateFormat: 'dd/mm/yyyy' };

describe('generated ids (IMP-3, review fix 5)', () => {
  it('IMP-3: "gen:" then 64 bits of hash (16 hex digits) then the position among identical rows', () => {
    const read = readRows([['When', 'What', 'Amount'], ['03/11/2026', 'Corner Bakery', '-4.20'], ['03/11/2026', 'Corner Bakery', '-4.20']], MAPPING);
    const ids = read.rows.map((r) => r.bankId);
    for (const id of ids) expect(id).toMatch(/^gen:[0-9a-f]{16}:\d+$/);
    expect(ids[0]?.split(':')[1]).toBe(ids[1]?.split(':')[1]);
    expect(ids.map((id) => id.split(':')[2])).toEqual(['1', '2']);
  });

  it('IMP-3: different rows get different hashes (many rows at once)', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.tuple(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 999_999 }), fc.string({ minLength: 1, maxLength: 12 })), {
      minLength: 50, maxLength: 300, selector: ([d, a, s]) => `${String(d)}|${String(a)}|${s.trim().toLowerCase().replace(/\s+/g, ' ')}`,
    }), (rows) => {
      const table = [['When', 'What', 'Amount'], ...rows.map(([d, a, s]) => [`${String(d).padStart(2, '0')}/11/2026`, `x${s}`, `-${String(a)}`])];
      const read = readRows(table, MAPPING);
      const hashes = read.rows.map((r) => r.bankId.split(':')[1]);
      expect(new Set(hashes).size).toBe(hashes.length);
    }), { numRuns: 30 });
  });
});

describe('decodeCsv: the file’s bytes as text (IMP-1, review fix 6)', () => {
  it('IMP-1: UTF-8 (with or without a byte-order mark) reads as UTF-8', () => {
    const utf8 = new TextEncoder().encode('Name,Amount\r\nCafé £1 이마트,-1.00\r\n');
    expect(decodeCsv(utf8)).toBe('Name,Amount\r\nCafé £1 이마트,-1.00\r\n');
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toContain('Café £1 이마트');
  });

  it('IMP-1: a windows-1252 file ("£" is the byte A3, "é" E9) reads with its pounds signs and accents', () => {
    const latin = 'Name,Amount\r\nCafé Lumière £5 off,-1.00\r\n';
    const bytes = Uint8Array.from(Array.from(latin, (ch) => ({ '£': 0xa3, 'é': 0xe9, 'è': 0xe8 })[ch] ?? ch.charCodeAt(0)));
    expect(bytes.includes(0xa3)).toBe(true);
    expect(decodeCsv(bytes)).toBe(latin);
  });

  it('IMP-1: nothing in, nothing out', () => {
    expect(decodeCsv(new Uint8Array())).toBe('');
  });
});

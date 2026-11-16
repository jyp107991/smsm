import { describe, expect, it } from 'vitest';
import { deferredIds, specIds, trace } from './trace-lib';

const spec = `
- ABC-1 First thing.
- **ABC-2** Second thing.
- XY-10 Third.
Not a criterion: ABC-9 mentioned in prose.
`;
const openItems = `
## Deferred criteria
- XY-10: later (S3).
## Ideas
- ABC-1: not a deferral, wrong section.
`;

describe('trace', () => {
  it('reads criterion ids from list items only', () => {
    expect(specIds(spec)).toEqual(['ABC-1', 'ABC-2', 'XY-10']);
  });
  it('reads deferrals only from the Deferred criteria section', () => {
    expect([...deferredIds(openItems).keys()]).toEqual(['XY-10']);
  });
  it('passes when every id is tested or deferred', () => {
    const r = trace({ spec, openItems, tests: [{ path: 'a.test.ts', text: "it('ABC-1 and ABC-2 work')" }] });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it('fails on an id that is neither tested nor deferred', () => {
    const r = trace({ spec, openItems, tests: [{ path: 'a.test.ts', text: "it('ABC-1')" }] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['ABC-2']);
  });
  it('fails on a test naming an id the spec does not define', () => {
    const r = trace({ spec, openItems, tests: [{ path: 'a.test.ts', text: "it('ABC-1 ABC-2 ABC-7')" }] });
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual([{ id: 'ABC-7', path: 'a.test.ts' }]);
  });
  it('fails on a deferral naming an unknown id', () => {
    const r = trace({ spec, openItems: '## Deferred criteria\n- ABC-5: x\n', tests: [{ path: 't', text: 'ABC-1 ABC-2 XY-10' }] });
    expect(r.unknown).toEqual([{ id: 'ABC-5', path: 'docs/OPEN_ITEMS.md' }]);
  });
});

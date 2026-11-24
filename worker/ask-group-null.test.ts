/**
 * Live eval run 45367987613 (24 Nov 2026): gpt-oss-120b answered "biggest grocery shop?" and "most expensive meal
 * out?" with `"group_by": null`, and the reply was refused as invalid (the schema allowed the key only absent). A null
 * group_by now means "no grouping", the same as leaving it out, in the schema (core/aiReplies askSchema), the Worker's
 * validation and askFilter. Recorded reply: tests/ai/replies/ask-group-by-null.json (the shape the run logged).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from './ai-core';
import { checkReply } from '../src/core/aiReplies';
import { askFilter, type AskLookups } from '../src/core/ask';

const recorded = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/ai/replies/ask-group-by-null.json'), 'utf8')) as { choices: { message: { content: string } }[] };
const text = recorded.choices[0]?.message.content ?? '';
const LOOKUPS: AskLookups = {
  categories: [{ id: 'c-groc', name: 'Groceries' }, { id: 'c-eat', name: 'Eating out' }],
  chapters: [], countries: [{ code: 'GB', name: 'United Kingdom' }],
  people: [{ id: 'u-a', name: 'Jae' }, { id: 'u-b', name: 'Sam' }], today: '2026-11-18',
};

describe('Ask smsm: "group_by": null is no grouping (INS-9; AI.md §3.5)', () => {
  it('INS-9: the recorded reply is valid on the Worker and on the phone', () => {
    expect(validate('ask', text)).toEqual({ ok: true, data: { measure: 'largest', filters: { categories: ['Groceries'] }, group_by: null } });
    expect(checkReply('ask', text)).toEqual({ measure: 'largest', filters: { categories: ['Groceries'] }, group_by: null });
  });

  it('INS-9: it reads as the same question as one with no group_by: the largest grocery entry, not grouped', () => {
    const reply = checkReply('ask', text);
    if (!reply) throw new Error('invalid');
    const q = askFilter(reply, LOOKUPS);
    expect(q?.groupBy).toBeNull();
    expect(q?.measure).toBe('largest');
    expect(q).toEqual(askFilter({ measure: 'largest', filters: { categories: ['Groceries'] } }, LOOKUPS));
  });

  it('INS-9: only null is new: an unknown grouping is still refused', () => {
    expect(checkReply('ask', { measure: 'total', filters: {}, group_by: 'week' })).toBeNull();
    expect(checkReply('ask', { measure: 'total', filters: {}, group_by: '' })).toBeNull();
  });

  it('INS-9: the prompt’s schema allows null for group_by', () => {
    const schema = JSON.parse(readFileSync(resolve(process.cwd(), 'worker/prompts/ask.schema.json'), 'utf8')) as { properties: { group_by: { type: unknown; enum?: unknown[] } } };
    expect(schema.properties.group_by.type).toEqual(['string', 'null']);
    expect(schema.properties.group_by.enum).toContain(null);
  });
});

/**
 * The two-user fixtures. Each scenario gets two fresh people (unique addresses, so scenarios never share a
 * household or a mailbox) on two phones with fixed clocks. After every scenario, whatever it did, the
 * balance is checked three ways (SPEC BAL-1, ENGINEERING §4.5):
 *   the sentence on both screens = core netPositions over the rows (service key) = the member_net view.
 */
import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { plankTilt } from '../../../src/ui/plank';
import { coreNet, householdOf, memberNet, type Household } from './admin';
import { balanceRegion, expectSentence, goHome, sentenceFor, waitingToSync } from './app';
import { clearMail } from './mail';
import { Phone } from './phone';

export interface Couple {
  /** The first person (starts the household, the cat). */
  jae: Phone;
  /** The second person (joins with the code, the dog). */
  sam: Phone;
}

interface Fixtures {
  /** Makes another phone (a third person, a different time zone). Closed after the test. */
  newPhone: (name: string, opts?: { timezoneId?: string }) => Phone;
  couple: Couple;
  /** Options for the couple's phones; override with test.use(). */
  samTimezone: string;
}

/** Waits for both phones to have sent everything, then compares the three balances. */
export async function expectBalanceAgrees(phones: readonly Phone[], email: string): Promise<Household> {
  for (const p of phones) {
    if (!p.isOpen) await p.open();
    await p.setOffline(false);
    await goHome(p.page);
    await expect(waitingToSync(p.page)).toBeHidden({ timeout: 30_000 });
  }
  const household = householdOf(email);
  if (household?.people.length !== 2) throw new Error('the scenario ended without two people in the household');
  const [a, b] = household.people;
  if (!a || !b) throw new Error('unreachable');
  const core = await coreNet(household);
  const db = memberNet(household.id);
  expect(db, 'member_net = core netPositions over the stored rows').toEqual({ [a.userId]: core[a.userId], [b.userId]: core[b.userId] });
  expect((core[a.userId] ?? 0) + (core[b.userId] ?? 0), 'the two nets sum to zero').toBe(0);
  const sentence = sentenceFor(core, household);
  for (const p of phones) {
    // A fresh open as well as the open screen: the phone's copy must not be stale (refetch on open).
    await expectSentence(p.page, sentence);
    await p.page.reload();
    await expectSentence(p.page, sentence);
    const tilts = await balanceRegion(p.page).locator('[data-tilt]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-tilt'))));
    expect(tilts.length, 'one plank on Home').toBe(1);
    expect(Math.abs(tilts[0] ?? NaN)).toBeCloseTo(Math.abs(plankTilt(core[a.userId] ?? 0)), 5);
  }
  return household;
}

export const test = base.extend<Fixtures>({
  samTimezone: ['Europe/London', { option: true }],

  newPhone: async ({}, use, testInfo) => {
    const made: Phone[] = [];
    const tag = randomUUID().slice(0, 8);
    await use((name, opts) => {
      const phone = new Phone({
        name,
        email: `${name.toLowerCase().replace(/[^a-z]/g, '') || 'person'}.${tag}.${String(made.length)}@example.com`,
        dir: testInfo.outputPath(`profile-${name}-${String(made.length)}`),
        ...(opts?.timezoneId ? { timezoneId: opts.timezoneId } : {}),
      });
      made.push(phone);
      return phone;
    });
    for (const p of made) {
      await p.close();
      await clearMail(p.email).catch(() => undefined);
    }
  },

  couple: async ({ newPhone, samTimezone }, use) => {
    const jae = newPhone('Jae');
    const sam = newPhone('Sam', { timezoneId: samTimezone });
    await jae.open();
    await sam.open();
    await use({ jae, sam });
    // After every scenario: screen = core = database, on both phones.
    if (householdOf(jae.email)?.people.length === 2) await expectBalanceAgrees([jae, sam], jae.email);
  },
});

export { expect };

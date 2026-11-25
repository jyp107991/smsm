/** S5a: the phone's rows as the Insights core reads them (kept in the data layer, shared with the recap wording). */
import type { Pace } from '../../core/insights';
import { strings } from '../../ui/strings';

export { toInsight, toSettle, toTemplate } from '../../data/insightRows';

/**
 * INS-1 (S9a review): the pace in words, the same on Home and in Insights' "This month": " · about £80 under your usual
 * pace", " · on your usual pace"; '' when there is no usual pace yet.
 */
export function paceTail(p: Pace): string {
  const whole = (x: number) => `£${Math.floor(x / 100).toLocaleString('en-GB')}`;
  return p.direction === 'under' && p.amount !== null ? strings.insights.under(whole(p.amount))
    : p.direction === 'over' && p.amount !== null ? strings.insights.over(whole(p.amount))
    : p.direction === 'on' ? strings.insights.onPace : '';
}

/** S10 (INS-10): the same pace in words for one person's own figures, with their name ("on Jae's usual pace"). */
export function ownPaceTail(p: Pace, name: string): string {
  const whole = (x: number) => `£${Math.floor(x / 100).toLocaleString('en-GB')}`;
  return p.direction === 'under' && p.amount !== null ? strings.insights.ownUnder(name, whole(p.amount))
    : p.direction === 'over' && p.amount !== null ? strings.insights.ownOver(name, whole(p.amount))
    : p.direction === 'on' ? strings.insights.ownOnPace(name) : '';
}

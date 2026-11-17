/** Activity's Dates filter (ACT-1): calendar ranges from the phone's today, with the core's date maths. */
import { addDays, addMonths, type IsoDate } from '../../core/dates';

export type DatesChoice = 'any' | 'thisMonth' | 'lastMonth' | 'last3' | 'thisYear';

export function datesRange(choice: DatesChoice, today: IsoDate): { from?: IsoDate; to?: IsoDate } {
  const month = `${today.slice(0, 7)}-01`;
  switch (choice) {
    case 'any':
      return {};
    case 'thisMonth':
      return { from: month, to: today };
    case 'lastMonth':
      return { from: addMonths(month, -1), to: addDays(month, -1) };
    case 'last3':
      return { from: addMonths(month, -2), to: today };
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

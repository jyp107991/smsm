/** Activity's Dates filter (ACT-1): calendar ranges from the phone's today, with the core's date maths. */
import { addDays, addMonths, type IsoDate } from '../../core/dates';

/** S2 polish Q-U10 adds "Last 7 days" (today and the six days before) and days the person picks. */
export type DatesChoice = 'any' | 'last7' | 'thisMonth' | 'lastMonth' | 'last3' | 'thisYear' | 'custom';

export interface DayRange {
  from: IsoDate;
  to: IsoDate;
}

export function datesRange(choice: DatesChoice, today: IsoDate, custom: DayRange | null = null): { from?: IsoDate; to?: IsoDate } {
  const month = `${today.slice(0, 7)}-01`;
  switch (choice) {
    case 'any':
      return {};
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisMonth':
      return { from: month, to: today };
    case 'lastMonth':
      return { from: addMonths(month, -1), to: addDays(month, -1) };
    case 'last3':
      return { from: addMonths(month, -2), to: today };
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom ? { from: custom.from, to: custom.to } : {};
  }
}

/**
 * S4a: the chapter screens' helpers: a chapter's entries as the core reads them, the sentence on its page, its
 * dates in words, and the countries a trip can be in (names from the phone's own Intl, no package).
 */
import { formatDate, type IsoDate } from '../../core/dates';
import { chapterSummary, type ChapterSummary } from '../../core/chapters';
import { formatPence, pence } from '../../core/money';
import type { ChapterRow, ExpenseRow } from '../../data';
import { strings } from '../../ui/strings';

export function summaryOf(chapter: ChapterRow, entries: readonly ExpenseRow[], people: readonly string[], today: IsoDate): ChapterSummary {
  return chapterSummary(
    { id: chapter.id, kind: chapter.kind === 'trip' ? 'trip' : 'project', startDate: chapter.start_date, endDate: chapter.end_date, closed: chapter.closed },
    entries.filter((e) => e.chapter_id === chapter.id).map((e) => ({
      chapterId: e.chapter_id,
      kind: e.kind === 'money_back' ? 'money_back' : 'expense', amount: pence(e.amount_pence), date: e.date, categoryId: e.category_id,
      paid: (e.paid && typeof e.paid === 'object' && !Array.isArray(e.paid) ? e.paid : {}) as Record<string, number>, deleted: e.deleted_at !== null,
    })),
    people,
    today,
  );
}

/** "£1,840.00 over 9 days, £204.44 a day" (trip), "£3,200.00 so far" (project), "£3,200.00 in all" (closed project). */
export function summarySentence(chapter: ChapterRow, s: ChapterSummary): string {
  const total = formatPence(s.total);
  if (chapter.kind === 'trip' && s.days > 0) return strings.chapters.overDays(total, s.days, s.perDay === null ? null : formatPence(s.perDay));
  return chapter.closed ? strings.chapters.inAll(total) : strings.chapters.soFar(total);
}

export function datesOf(chapter: ChapterRow, today: IsoDate): string | null {
  const { start_date: from, end_date: to } = chapter;
  if (from && to) return strings.chapters.dates(formatDate(from, today), formatDate(to, today));
  if (from) return strings.chapters.from(formatDate(from, today));
  if (to) return strings.chapters.until(formatDate(to, today));
  return null;
}

// ISO 3166-1 alpha-2 codes; their names come from Intl.DisplayNames in English.
const CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG '
  + 'CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN '
  + 'GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS '
  + 'LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG '
  + 'PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM '
  + 'TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');

let countries: { code: string; name: string }[] | null = null;
export function countryList(): { code: string; name: string }[] {
  if (countries) return countries;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
  } catch {
    names = null;
  }
  countries = CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  return countries;
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  return countryList().find((c) => c.code === code)?.name ?? code;
}

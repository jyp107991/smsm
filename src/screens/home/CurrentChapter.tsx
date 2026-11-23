/**
 * Beside quick add on Home (DESIGN §4.1): only when not everyday or not at home.
 * - CHP-2: while this phone has a current chapter, a chip says where new entries go ("Adding to Japan"); tapping it
 *   opens the chapter.
 * - PLC-3, PLC-6 (S9a): while this phone is in another country, a chip names it ("Japan 🇯🇵"; a bare amount in quick
 *   add is then in that country's money); tapping it opens a small sheet with the current country to change it.
 */
import { useState } from 'react';
import { homeCountry, useChapters, useCurrentChapter, useCurrentCountry, useHousehold } from '../../data';
import { Sheet } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { countryName } from '../chapters/model';
import { CurrentCountryField } from '../places/WhereYouAre';

/** "JP" → "🇯🇵" (the two regional indicator letters). */
function flagOf(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(0x1f1e6 + code.charCodeAt(0) - 65, 0x1f1e6 + code.charCodeAt(1) - 65) : '';
}

const CHIP = 'bg-forest-tint text-forest text-secondary press inline-flex min-h-11 max-w-full items-center gap-2 rounded-[12px] px-3 font-medium';

export function CurrentChips() {
  const id = useCurrentChapter();
  const chapter = useChapters().data?.find((c) => c.id === id);
  const country = useCurrentCountry();
  const home = useHousehold().data?.home_country ?? homeCountry();
  const [choosing, setChoosing] = useState(false);
  const abroad = country !== home;
  if (!chapter && !abroad && !choosing) return null;
  return (
    <div className="-mb-3 flex flex-wrap gap-2">
      {chapter ? (
        <button type="button" onClick={() => { go({ name: 'chapter', id: chapter.id }); }} className={CHIP}>
          <span aria-hidden="true" className="leading-none">{chapter.emoji}</span>
          <span className="min-w-0 truncate">{strings.chapters.adding(chapter.name)}</span>
        </button>
      ) : null}
      {abroad ? (
        <button type="button" onClick={() => { setChoosing(true); }} className={CHIP}>
          <span className="min-w-0 truncate">{countryName(country)}</span>
          <span aria-hidden="true" className="leading-none">{flagOf(country)}</span>
        </button>
      ) : null}
      <Sheet open={choosing} onOpenChange={setChoosing} title={strings.places.whereYouAre}>
        <CurrentCountryField />
      </Sheet>
    </div>
  );
}

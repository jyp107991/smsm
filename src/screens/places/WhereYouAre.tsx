/**
 * Settings → "Where you are" (S4b; PLC-2, PLC-3): this phone's current country (new entries take it) and the
 * "Use location" switch with its reason. Turning it on lets the browser ask once; refused, smsm carries on without.
 */
import { useId } from 'react';
import { askLocation, setCurrentCountry, setUseLocation, useCurrentCountry, useLocationSetting } from '../../data';
import { useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { countryList } from '../chapters/model';
import { Toggle } from '../entry/RecurringParts';

export function WhereYouAre() {
  const id = useId();
  const country = useCurrentCountry();
  const useLocation = useLocationSetting();
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-country`} className="text-secondary text-ink-2 font-medium">{strings.places.currentCountry}</label>
        <select
          id={`${id}-country`}
          value={country}
          onChange={(e) => { setCurrentCountry(e.target.value); }}
          aria-describedby={`${id}-line`}
          className="bg-sunk text-ink text-body min-h-12 w-full rounded-[12px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {countryList().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <p id={`${id}-line`} className="text-secondary text-ink-2 m-0">{strings.places.currentLine}</p>
      </div>
      <Toggle
        label={strings.places.useLocation}
        hint={strings.places.useLocationWhy}
        on={useLocation}
        onChange={(on) => {
          setUseLocation(on);
          if (!on) return;
          // The browser asks now, once; if it isn't allowed, the switch goes back off and says so (offline is
          // fine: the permission is what counts, not the place name).
          void askLocation().then((allowed) => {
            if (!allowed) {
              setUseLocation(false);
              toast.show({ message: strings.places.locationDenied });
            }
          });
        }}
      />
    </div>
  );
}

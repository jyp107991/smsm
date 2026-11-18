/**
 * The Add sheet's receipt parts (S6a; SCAN-1…5): the buttons that take or choose a photo, the photo itself with
 * Remove photo and Sort it later, the quiet reading line, and Itemise (each line ticked as shared; unticking one
 * person's own lines changes the amount; a total that doesn't add up is said in words, and the person sets it).
 */
import { Camera, ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';
import { formatForeign } from '../../core/fx';
import { formatPence, type Pence } from '../../core/money';
import { Button, ICON } from '../../ui/primitives';
import { strings } from '../../ui/strings';

/** A button that opens the camera or the photo library (a file input, images only). */
export function PhotoButton({ label, scan, onPicked }: { label: string; scan: boolean; onPicked: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="plain"
        onClick={() => { input.current?.click(); }}
        icon={scan ? Camera : ImagePlus}
      >
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        // Scanning offers the camera first; adding a photo lets the person choose from the library too.
        {...(scan ? { capture: 'environment' as const } : {})}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPicked(file);
        }}
      />
    </>
  );
}

export type ReadingState = 'idle' | 'reading' | 'failed' | 'limit';

/** The photo kept with the entry, what is happening with it, and what can be done with it. */
export function ReceiptPhoto({ url, reading, onRemove, onSortLater }: {
  url: string | null;
  reading: ReadingState;
  onRemove: () => void;
  onSortLater: (() => void) | null;
}) {
  const line = reading === 'reading' ? strings.smart.reading : reading === 'failed' ? strings.smart.couldnt : reading === 'limit' ? strings.smart.enough : null;
  return (
    <div className="flex items-start gap-3">
      <div className="bg-sunk size-20 shrink-0 overflow-hidden rounded-[12px]">
        {url ? <img src={url} alt={strings.smart.photo} className="size-full object-cover" /> : <span role="img" aria-label={strings.smart.photo} className="block size-full" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* One quiet line, never a dialog (AI.md §4); polite, so a screen reader hears it when it changes. */}
        <p aria-live="polite" className="text-secondary text-ink-2 m-0 min-h-[1.4rem]">{line}</p>
        <div className="flex flex-wrap gap-x-1">
          <button type="button" onClick={onRemove} className="text-forest text-secondary press -ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2">
            <X size={16} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.smart.removePhoto}
          </button>
          {onSortLater ? (
            <button type="button" onClick={onSortLater} className="text-forest text-secondary press inline-flex min-h-11 items-center rounded-full px-2">
              {strings.smart.sortLater}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export interface ItemLine { label: string; pence: Pence; shared: boolean }

/** SCAN-2, SCAN-3: the receipt's lines as checkboxes; the mismatch said in words when they don't add up. */
export function Itemise({ items, mismatch, currency, onToggle }: {
  items: readonly ItemLine[];
  mismatch: { lines: Pence; total: Pence } | null;
  /** The receipt's own currency (its lines are hundredths of it); pounds when null or GBP. */
  currency: string | null;
  onToggle: (index: number) => void;
}) {
  const money = (p: Pence) => (currency === null || currency === 'GBP' ? formatPence(p) : formatForeign(p / 100, currency));
  return (
    <fieldset className="m-0 mb-4 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="text-secondary text-ink-2 mb-1 p-0 font-medium">{strings.smart.itemise}</legend>
      {mismatch ? (
        <p className="text-secondary text-berry m-0 mb-1">{strings.smart.mismatch(money(mismatch.lines), money(mismatch.total))}</p>
      ) : (
        <p className="text-caption text-ink-2 m-0 mb-1">{strings.smart.itemiseHint}</p>
      )}
      {items.map((line, i) => (
        <label key={`${String(i)}-${line.label}`} className="border-line flex min-h-11 items-center gap-3 border-b last:border-b-0">
          <input
            type="checkbox"
            checked={line.shared}
            onChange={() => { onToggle(i); }}
            aria-label={`${line.label} ${money(line.pence)}`}
            className="accent-forest size-5 shrink-0"
          />
          <span className="text-body min-w-0 flex-1 break-words">{line.label}</span>
          <span className="text-body nums-list shrink-0">{money(line.pence)}</span>
        </label>
      ))}
    </fieldset>
  );
}

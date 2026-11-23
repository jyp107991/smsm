/**
 * A receipt photo (S6a), fetched from the phone's copy or storage; its place is kept while it comes (no layout
 * shift). On the entry page it opens full size; on a chapter page (S9b, CHP-3) a small one in the photo strip.
 */
import { useEffect, useState } from 'react';
import { photoUrl } from '../../data';
import { strings } from '../../ui/strings';
import { cx } from '../../ui/primitives/util';

export function usePhotoUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void photoUrl(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  return url;
}

export function ReceiptImage({ path }: { path: string }) {
  const url = usePhotoUrl(path);
  return (
    <figure className="m-0">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
          <img src={url} alt={strings.smart.photo} className="bg-sunk max-h-72 max-w-full rounded-[12px] object-contain" />
        </a>
      ) : (
        <span role="img" aria-label={strings.smart.photo} className="bg-sunk block h-40 w-32 rounded-[12px]" />
      )}
    </figure>
  );
}

/** A small photo of a fixed size (the chapter page's strip). */
export function ReceiptThumb({ path, className }: { path: string; className?: string }) {
  const url = usePhotoUrl(path);
  return url
    ? <img src={url} alt={strings.smart.photo} width={80} height={104} className={cx('bg-sunk block h-26 w-20 rounded-[12px] object-cover', className)} />
    : <span role="img" aria-label={strings.smart.photo} className={cx('bg-sunk block h-26 w-20 rounded-[12px]', className)} />;
}

/**
 * PPL-1, BAL-6: sharing the join code. The phone's own share sheet where there is one; otherwise the
 * invite is copied, and the person is told.
 */
import { strings } from '../../ui/strings';

export async function shareInvite(code: string, copied: () => void): Promise<void> {
  const text = strings.settings.shareText(code);
  const url = typeof location === 'undefined' ? undefined : location.origin;
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: strings.app.name, text, ...(url ? { url } : {}) });
      return;
    }
  } catch (err) {
    // The person closed the share sheet: nothing more to do.
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    copied();
  } catch {
    /* no clipboard either: the code is on screen in Settings */
  }
}

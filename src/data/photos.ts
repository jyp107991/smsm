/**
 * Receipt photos on the phone (S6a): shrunk to 1280 px on the long side as JPEG before they leave the phone
 * (AI.md §2; drawing to a canvas also drops the camera's EXIF, location included), kept as text in the phone's
 * store until uploaded (non-negotiable 5: an entry with a photo saves at once, offline too), and named
 * `<household>/<uuid>.jpg` in the private `receipts` bucket.
 */
export const LONG_SIDE = 1280;
export const QUALITY = 0.8;

export function receiptPath(householdId: string, id: string = crypto.randomUUID()): string {
  return `${householdId}/${id}.jpg`;
}

export class PhotoUnreadableError extends Error {
  constructor() {
    super('That photo can’t be used here. Try another, or a screenshot of it.');
    this.name = 'PhotoUnreadableError';
  }
}

/**
 * The photo as a JPEG no longer than 1280 px on either side. A photo the browser can't draw is refused, never sent
 * as it is: the original may carry the camera's location (EXIF), and only a redrawn copy is sure not to.
 */
export async function shrink(photo: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new PhotoUnreadableError();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoUnreadableError();
  }
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PhotoUnreadableError();
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoUnreadableError();
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => { if (b) resolve(b); else reject(new PhotoUnreadableError()); }, 'image/jpeg', QUALITY);
    });
  } finally {
    bitmap.close();
  }
}

/** Base64 without the data-URL prefix (what the AI route and the phone's text store take). */
export async function toBase64(photo: Blob): Promise<string> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function fromBase64(data: string, type = 'image/jpeg'): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

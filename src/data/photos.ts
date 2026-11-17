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

/** The photo as a JPEG no longer than 1280 px on either side; the original when the browser can't draw it. */
export async function shrink(photo: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return photo;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  } catch {
    return photo;
  }
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return photo;
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return photo;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => { resolve(b ?? photo); }, 'image/jpeg', QUALITY);
    });
  } finally {
    bitmap.close();
  }
}

/** Base64 without the data-URL prefix (what Gemini and the phone's text store take). */
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

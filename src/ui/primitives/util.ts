/** Lucide icons everywhere (DESIGN §3.3): 22 px, 1.75 px stroke, ink colour by inheritance. */
export const ICON = { size: 22, stroke: 1.75 } as const;

/** Joins class names, skipping false, null and undefined. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

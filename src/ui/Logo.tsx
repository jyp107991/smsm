/**
 * smsm's mark (DESIGN §2.2): ㅅ (the roof) stacked on ㅁ (the walls) so the pair reads as a house.
 * One constant stroke of 12% of the icon's width, round caps and joins; the ㅅ is about 120% of the
 * ㅁ's width so it overhangs like eaves; the mark sits inside the central 66% (maskable safe zone).
 * Three variants for the owner to choose between in the gallery:
 *   a: plain.
 *   b: the ㅁ has a door: a gap in its bottom stroke.
 *   c: the eaves rest on the walls, so roof and walls are one connected house.
 * The same geometry (100-unit space) is used, scaled, by public/icons/logo-{a,b,c}.svg.
 */
export type LogoVariant = 'a' | 'b' | 'c';

export const LOGO_STROKE = 12;

export interface LogoMark {
  roof: string;
  walls: string;
}

/** The mark's two strokes in a 100 × 100 space, for each variant. */
export const LOGO_MARKS: Record<LogoVariant, LogoMark> = {
  a: { roof: 'M32 39L50 23L68 39', walls: 'M43 53H57A7 7 0 0 1 64 60V70A7 7 0 0 1 57 77H43A7 7 0 0 1 36 70V60A7 7 0 0 1 43 53Z' },
  b: { roof: 'M32 39L50 23L68 39', walls: 'M41.5 77H43A7 7 0 0 1 36 70V60A7 7 0 0 1 43 53H57A7 7 0 0 1 64 60V70A7 7 0 0 1 57 77H58.5' },
  c: { roof: 'M29.6 48L50 25L70.4 48', walls: 'M42 48H58A7 7 0 0 1 65 55V68A7 7 0 0 1 58 75H42A7 7 0 0 1 35 68V55A7 7 0 0 1 42 48Z' },
};

export function Logo({ size = 48, variant = 'a', title = 'smsm' }: { size?: number; variant?: LogoVariant; title?: string }) {
  const mark = LOGO_MARKS[variant];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} data-variant={variant}>
      <rect width="100" height="100" rx="22" fill="var(--forest)" />
      <g fill="none" stroke="var(--on-forest)" strokeWidth={LOGO_STROKE} strokeLinecap="round" strokeLinejoin="round">
        <path d={mark.roof} />
        <path d={mark.walls} />
      </g>
    </svg>
  );
}

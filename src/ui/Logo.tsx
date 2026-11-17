import { strings } from './strings';
/**
 * smsm's mark (DESIGN §2.2): ㅅ (the roof) stacked on ㅁ (the walls) so the pair reads as a house, while
 * each stays a recognisable Hangul letter. One constant stroke, round caps and joins; the ㅅ is about 120%
 * of the ㅁ's width; the mark sits inside the central 66% (maskable safe zone).
 * Three variants for the owner to choose between in the gallery:
 *   a: plain, sans-serif letterforms.
 *   b: as A, with a door: a gap in ㅁ's bottom stroke.
 *   c: a ㅅ whose legs sweep outward at the feet, like eaves.
 * The same geometry (100-unit space) is used, scaled, by public/icons/logo-{a,b,c}.svg.
 */
export type LogoVariant = 'a' | 'b' | 'c';

/** 9% of the icon (DESIGN said about 12%; at 12 the two letters merged into one shape: owner feedback). */
export const LOGO_STROKE = 9;

export interface LogoMark {
  roof: string;
  walls: string;
}

/**
 * The mark's two letters in a 100 × 100 space, drawn from real Hangul letterforms and made symmetric (owner):
 * ㅅ's two steep legs leave the apex as mirror images; ㅁ is a square whose sharp inner corners give only
 * the stroke's own rounding outside.
 */
export const LOGO_MARKS: Record<LogoVariant, LogoMark> = {
  a: { roof: 'M50 15Q46.5 33 30 46M50 15Q53.5 33 70 46', walls: 'M34 57H66V84H34Z' },
  b: { roof: 'M50 15Q46.5 33 30 46M50 15Q53.5 33 70 46', walls: 'M45 84H34V57H66V84H55' },
  c: { roof: 'M50 14C49 30 41 41 28 47M50 14C51 30 59 41 72 47', walls: 'M35 58H65V84H35Z' },
};

export function Logo({ size = 48, variant = 'a', title = strings.app.name }: { size?: number; variant?: LogoVariant; title?: string }) {
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

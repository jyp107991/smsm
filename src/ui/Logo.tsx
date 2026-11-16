/**
 * smsm's mark: ㅅ (the roof) stacked on ㅁ (the walls) so the pair reads as a house (DESIGN §2.2).
 * Provisional: the owner chooses between three variants in the gallery; this is variant A.
 */
export function Logo({ size = 48, title = 'smsm' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title}>
      <rect width="100" height="100" rx="22" fill="var(--forest)" />
      <g fill="none" stroke="var(--on-forest)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 46 L50 24 L76 46" />
        <rect x="30" y="54" width="40" height="28" rx="6" />
      </g>
    </svg>
  );
}

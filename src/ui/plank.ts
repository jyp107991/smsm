/**
 * The Home plank's tilt (SPEC BAL-3, DESIGN §4.1).
 * The plank tilts in proportion to the balance, capped at PLANK_MAX_DEG, reached at PLANK_FULL_TILT_PENCE.
 * Positive degrees mean the left animal is owed: its end rises, which is a clockwise CSS rotation.
 */
export const PLANK_MAX_DEG = 8;
export const PLANK_FULL_TILT_PENCE = 20000;

/** Degrees of tilt for the left person's net position in pence (positive: the left person is owed). */
export function plankTilt(leftNetPence: number): number {
  if (!Number.isFinite(leftNetPence)) {
    if (Number.isNaN(leftNetPence)) return 0;
    return leftNetPence > 0 ? PLANK_MAX_DEG : -PLANK_MAX_DEG;
  }
  if (leftNetPence === 0) return 0;
  const magnitude = Math.min(PLANK_MAX_DEG, (PLANK_MAX_DEG * Math.abs(leftNetPence)) / PLANK_FULL_TILT_PENCE);
  if (magnitude === 0) return 0; // never -0
  return leftNetPence > 0 ? magnitude : -magnitude;
}

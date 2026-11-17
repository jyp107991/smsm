/**
 * A category's mark beside its name: the emoji the household gave it, or, for a category with none of its own
 * (the database's placeholder "•", as "Other" has), its colour dot (S2 polish Q-L11). Never a bare "•".
 */
import { categoryColour } from '../../ui/tokens';

/** The database's default emoji (a plain dot) for a category nobody gave one. */
export function isPlaceholderEmoji(emoji: string | null | undefined): boolean {
  const e = (emoji ?? '').trim();
  return e === '' || e === '•';
}

export function CategoryMark({ emoji, colour, className }: { emoji: string | null | undefined; colour: string; className?: string }) {
  if (isPlaceholderEmoji(emoji)) {
    return (
      <span aria-hidden="true" className={className}>
        <span className="inline-block size-2.5 rounded-full align-middle" style={{ background: `var(--cat-${categoryColour(colour)})` }} />
      </span>
    );
  }
  return <span aria-hidden="true" className={className}>{emoji}</span>;
}

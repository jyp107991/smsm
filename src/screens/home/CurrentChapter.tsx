/**
 * CHP-2 on Home (DESIGN §4.1): while this phone has a current chapter, a chip beside quick add says where new
 * entries go ("Adding to Japan"); tapping it opens the chapter. Nothing shows for everyday.
 */
import { useChapters, useCurrentChapter } from '../../data';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';

export function CurrentChapterChip() {
  const id = useCurrentChapter();
  const chapter = useChapters().data?.find((c) => c.id === id);
  if (!chapter) return null;
  return (
    <div className="-mb-3 flex">
      <button
        type="button"
        onClick={() => { go({ name: 'chapter', id: chapter.id }); }}
        className="bg-forest-tint text-forest text-secondary press inline-flex min-h-11 max-w-full items-center gap-2 rounded-[12px] px-3 font-medium"
      >
        <span aria-hidden="true" className="leading-none">{chapter.emoji}</span>
        <span className="min-w-0 truncate">{strings.chapters.adding(chapter.name)}</span>
      </button>
    </div>
  );
}

/**
 * S9b (ADD-4): an entry's tags under More details. Each tag is a chip whose tap takes it off ("Remove wedding");
 * "Add a tag" takes one at a time: Enter (or leaving the box) adds what was typed, without a leading "#" (as quick
 * add writes them), and never saves the sheet. The same tag twice, in any case, is kept once.
 */
import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { isComposingKey } from '../../ui/keys';
import { strings } from '../../ui/strings';

/** A tag as typed, made ready to keep: no leading "#", no outer spaces; '' when nothing is left. */
export function cleanTag(typed: string): string {
  return typed.trim().replace(/^#+/, '').trim().slice(0, 40);
}

export function TagsField({ tags, onChange }: { tags: readonly string[]; onChange: (tags: readonly string[]) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const add = () => {
    const tag = cleanTag(text);
    setText('');
    if (tag === '') return;
    const key = tag.normalize('NFKC').toLowerCase();
    if (tags.some((t) => t.normalize('NFKC').toLowerCase() === key)) return;
    onChange([...tags, tag]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // The Enter belongs to the tag box: it adds, it never submits the form (TXT-2: nor while composing).
    e.preventDefault();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229: see isComposingKey
    if (isComposingKey({ keyCode: e.keyCode, nativeEvent: e.nativeEvent })) return;
    add();
  };
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-secondary text-ink-2 font-medium">{strings.entry.tags}</span>
      {tags.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-2 gap-y-3 p-0 pt-1 pb-1">
          {tags.map((t) => (
            <li key={t} className="flex max-w-full min-w-0">
              <button
                type="button"
                aria-label={strings.entry.removeTag(t)}
                onClick={() => { onChange(tags.filter((x) => x !== t)); }}
                className={
                  'bg-sunk text-ink text-secondary press relative inline-flex h-9 max-w-full min-w-11 items-center gap-1 rounded-[12px] pr-2 pl-3 font-medium select-none active:scale-[0.97] '
                  // The hit area: 44 px tall around the 36 px chip (DESIGN §6).
                  + 'before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]'
                }
              >
                <span className="min-w-0 truncate">{t}</span>
                <X size={16} strokeWidth={2.25} aria-hidden="true" className="text-ink-2 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="bg-sunk focus-within:outline-forest flex min-h-12 items-center rounded-[12px] px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid">
        <input
          type="text"
          aria-label={strings.entry.addTag}
          placeholder={strings.entry.addTag}
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={onKeyDown}
          onBlur={add}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="none"
          maxLength={60}
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-2 outline-none"
        />
      </div>
    </div>
  );
}

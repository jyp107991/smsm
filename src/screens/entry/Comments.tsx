/**
 * Comments on an entry (S5b; ACT-4): a short thread, oldest first ("Sam: was this the big shop?"), a box to add
 * one, and Edit / Delete on your own (a deleted comment stays as "Deleted"). Saved through the queue, offline too;
 * the partner sees it within seconds. Nobody can change the other person's comments.
 */
import { useId, useState, type SyntheticEvent } from 'react';
import { addComment, deleteComment, editComment, useComments, useDataLayer, useSyncStatus, type CommentRow } from '../../data';
import { enterSavesOnce } from '../../ui/keys';
import { Button, Field, Sheet } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { whenWords } from '../shared/words';

export function Comments({ expenseId }: { expenseId: string }) {
  const layer = useDataLayer();
  const today = layer.today();
  const comments = useComments(expenseId).data ?? [];
  const people = usePeople();
  const { otherWindow } = useSyncStatus();
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CommentRow | null>(null);
  const me = people.me?.id;
  const name = (uid: string) => people.list.find((p) => p.id === uid)?.name ?? strings.history.someone;

  const send = (e: SyntheticEvent) => {
    e.preventDefault();
    if (text.trim() === '') return;
    try {
      addComment(expenseId, text);
      setText('');
      setError(null);
    } catch (err) {
      setError(plainError(err));
    }
  };

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-subtitle rule-ledger m-0">{strings.comments.title}</h2>
      {comments.length === 0 ? <p className="text-secondary text-ink-2 m-0">{strings.comments.none}</p> : (
        <ol aria-labelledby={id} className="m-0 flex list-none flex-col p-0">
          {comments.map((c) => (
            <li key={c.id} className="border-line flex flex-col gap-1 border-b py-2.5 last:border-b-0">
              {c.deleted_at !== null ? (
                <p className="text-secondary text-ink-2 m-0">{strings.comments.deleted(name(c.author))}</p>
              ) : (
                <p className="text-body m-0 break-words"><span className="font-medium">{name(c.author)}:</span> {c.body}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3">
                <span className="text-caption text-ink-2">{whenWords(c.created_at, today)}</span>
                {c.author === me && c.deleted_at === null && !otherWindow ? (
                  <>
                    <button type="button" aria-label={strings.comments.editLabel} onClick={() => { setEditing(c); }} className="text-forest text-secondary press inline-flex min-h-11 items-center rounded-full px-2">
                      {strings.comments.edit}
                    </button>
                    <button type="button" aria-label={strings.comments.deleteLabel} onClick={() => { deleteComment(c.id); }} className="text-forest text-secondary press inline-flex min-h-11 items-center rounded-full px-2">
                      {strings.comments.delete}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {!otherWindow ? (
        <form onSubmit={send} className="flex items-end gap-2">
          <Field
            label={strings.comments.add}
            className="min-w-0 flex-1"
            value={text}
            maxLength={500}
            autoComplete="off"
            enterKeyHint="send"
            onKeyDown={enterSavesOnce}
            onChange={(e) => { setText(e.target.value); setError(null); }}
          />
          <Button type="submit" disabled={text.trim() === ''}>{strings.comments.send}</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
      <EditSheet comment={editing} onClose={() => { setEditing(null); }} />
    </section>
  );
}

function EditSheet({ comment, onClose }: { comment: CommentRow | null; onClose: () => void }) {
  const [opened, setOpened] = useState<{ c: CommentRow; n: number } | null>(null);
  if (comment !== null && opened?.c !== comment) setOpened({ c: comment, n: (opened?.n ?? 0) + 1 });
  if (!opened) return null;
  return <EditForm key={opened.n} comment={opened.c} open={comment !== null} onClose={onClose} />;
}

function EditForm({ comment, open, onClose }: { comment: CommentRow; open: boolean; onClose: () => void }) {
  const [text, setText] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const save = (e: SyntheticEvent) => {
    e.preventDefault();
    try {
      editComment(comment.id, text);
    } catch (err) {
      setError(plainError(err));
      return;
    }
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={strings.comments.editTitle}
      dirty={text !== comment.body}
      footer={(
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button type="submit" form={formId} block>{strings.entry.save}</Button>
        </div>
      )}
    >
      <form id={formId} onSubmit={save} noValidate>
        <Field label={strings.comments.comment} value={text} maxLength={500} autoComplete="off" onChange={(e) => { setText(e.target.value); setError(null); }} />
      </form>
    </Sheet>
  );
}

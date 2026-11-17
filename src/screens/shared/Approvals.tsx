/**
 * PPL-4, PPL-5: changes that need both people. The partner sees what was asked, with Approve and Decline
 * (the requester's animal peeking over the banner, DESIGN §2.3); the requester sees "Waiting for Sam" and
 * can cancel. Deciding needs a connection (OFF-4) and says so.
 *
 * The banner (Q-L9): the animal's head sits behind the card's top edge and its paws lie over it, in front;
 * Approve is the primary action, Decline a quiet one beside it.
 */
import { useState } from 'react';
import { decideChange, useChangeRequests, type ChangeRequestRow } from '../../data';
import { Animal, PEEK_GRIP } from '../../ui/rig/Animal';
import { PEEK_EDGE } from '../../ui/rig/shapes';
import { Button } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { usePeople } from './people';
import { plainError } from './plain';
import { requestWords } from './words';

/** The peeking animal's size, in px. */
const PEEK = 64;
/**
 * Where the card's top edge meets the drawing, from its top, in px: a little above the paws' base (PEEK_GRIP),
 * so the paws lie over the edge. The peeking view box starts at y = −16.6 and is 88 units tall.
 */
const EDGE = Math.round((PEEK * (PEEK_EDGE - PEEK_GRIP + 16.6)) / 88);

function usePending(): ChangeRequestRow[] {
  return (useChangeRequests().data ?? []).filter((r) => r.status === 'pending');
}

function useDecide() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, approve: boolean) => {
    setBusy(`${id}:${String(approve)}`);
    setError(null);
    try {
      await decideChange(id, approve);
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, decide };
}

/** The partner's requests waiting for this person's decision. */
export function ApprovalBanners() {
  const people = usePeople();
  const pending = usePending();
  const { busy, error, decide } = useDecide();
  const me = people.me?.id ?? '';
  const theirs = pending.filter((r) => r.requested_by !== me);
  if (theirs.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {theirs.map((r) => {
        const who = people.list.find((p) => p.id === r.requested_by);
        return (
          <div key={r.id} className="relative isolate" style={who ? { paddingTop: EDGE } : undefined}>
            {who ? (
              <span aria-hidden="true" className="absolute top-0 left-5 -z-10">
                <Animal kind={who.animal} pose="peeking" layer="behind" mood="curious" size={PEEK} motion={false} />
              </span>
            ) : null}
            <div className="bg-surface border-line flex flex-col gap-3 rounded-[16px] border px-4 pt-3.5 pb-3">
              <p className="text-note m-0 break-words text-balance">{requestWords(r, people.list, me)}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <Button loading={busy === `${r.id}:true`} onClick={() => void decide(r.id, true)}>
                  {strings.settings.approve}
                </Button>
                <Button variant="quiet" loading={busy === `${r.id}:false`} onClick={() => void decide(r.id, false)}>
                  {strings.settings.decline}
                </Button>
              </div>
            </div>
            {who ? (
              <span aria-hidden="true" className="pointer-events-none absolute top-0 left-5">
                <Animal kind={who.animal} pose="peeking" layer="front" mood="curious" size={PEEK} motion={false} />
              </span>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-secondary text-berry m-0" aria-live="polite">{error}</p> : null}
    </div>
  );
}

/** This person's own requests: "Waiting for Sam", with Cancel request. */
export function MyRequests() {
  const people = usePeople();
  const pending = usePending();
  const { busy, error, decide } = useDecide();
  const me = people.me?.id ?? '';
  const mine = pending.filter((r) => r.requested_by === me);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {mine.map((r) => (
        <div key={r.id} className="bg-sunk/60 flex flex-col gap-2 rounded-[12px] px-4 py-3">
          <p className="m-0 break-words">{requestWords(r, people.list, me)}</p>
          <p className="text-secondary text-ink-2 m-0">{strings.settings.waitingFor(people.partner?.name ?? '')}</p>
          <div>
            <Button variant="plain" loading={busy === `${r.id}:false`} onClick={() => void decide(r.id, false)}>
              {strings.settings.cancelRequest}
            </Button>
          </div>
        </div>
      ))}
      {error ? <p className="text-secondary text-berry m-0" aria-live="polite">{error}</p> : null}
    </div>
  );
}

/**
 * SET-2, S2 polish Q-U2: "Did it go through?" as the app holds it while it is open. The question is kept on
 * the phone (monzo.ts, IndexedDB) so it survives the app being closed on the way back from Monzo. When the
 * app opens with a question never answered, Settle up asks it; after "Not yet" a quiet Home banner holds it
 * ("Did Sam’s £20.00 to Jae go through?" Yes · Not yet · Forget it) until it is answered. The banner's own
 * "Not yet" only puts it away until the app next opens.
 */
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatPence, pence } from '../../core/money';
import { addSettlement, deleteSettlement, newId, useDataLayer } from '../../data';
import { tickSettled } from '../../ui/haptics';
import { Button, useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { loadPending, savePending, type PendingMonzo } from './monzo';

export interface MonzoQuestion {
  /** The question kept on this phone, if any. */
  pending: PendingMonzo | null;
  /** The banner's own "Not yet": put away until the app next opens. */
  bannerHidden: boolean;
  /** On the way to Monzo: keep the question (the sheet asks it on return). */
  ask: (p: PendingMonzo) => void;
  /** "Not yet" in the sheet: keep it, and Home shows the quiet banner. */
  later: (p: PendingMonzo) => void;
  /** Answered (Yes) or Forget it: nothing more to ask. */
  forget: () => void;
  hideBanner: () => void;
}

/** Outside the signed-in app (nothing to show a banner on) the question is only kept. */
const keepOnly: MonzoQuestion = {
  pending: null,
  bannerHidden: true,
  ask: (p) => { void savePending(p); },
  later: (p) => { void savePending({ ...p, later: true }); },
  forget: () => { void savePending(null); },
  hideBanner: () => undefined,
};

const QuestionContext = createContext<MonzoQuestion>(keepOnly);

export function useMonzoQuestion(): MonzoQuestion {
  return use(QuestionContext);
}

/**
 * Holds the question for the signed-in app. `onUnanswered` hears, once, about a question found on opening
 * that was never answered, so Settle up can ask it again.
 */
export function MonzoQuestionProvider({ onUnanswered, children }: { onUnanswered: (p: PendingMonzo) => void; children: ReactNode }) {
  const [pending, setPending] = useState<PendingMonzo | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [first] = useState(() => onUnanswered);
  const layer = useDataLayer();
  useEffect(() => {
    let live = true;
    void loadPending().then((p) => {
      if (!live || !p) return;
      const me = layer.me();
      const pair = layer.members().map((m) => m.user_id);
      // Only the person who asked is asked, and only about the two people in this household; a question
      // already recorded (its row is here) is done. Anything else is forgotten.
      const theirs = p.by === undefined || p.by === me;
      const ours = p.from !== p.to && pair.includes(p.from) && pair.includes(p.to);
      if (!theirs || !ours || me === null || (p.id !== undefined && layer.settlements().some((s) => s.id === p.id))) {
        void savePending(null);
        return;
      }
      // A question kept by an earlier version gets its row id now, kept with it.
      let q = p;
      if (q.id === undefined || q.by === undefined) {
        q = { ...q, id: q.id ?? newId(), by: q.by ?? me };
        void savePending(q);
      }
      setPending(q);
      if (!q.later) first(q);
    });
    return () => { live = false; };
  }, [first, layer]);
  const [api] = useState(() => ({
    ask: (p: PendingMonzo) => {
      const kept = { ...p };
      delete kept.later;
      setPending(kept);
      void savePending(kept);
    },
    later: (p: PendingMonzo) => {
      const kept = { ...p, later: true };
      setPending(kept);
      setBannerHidden(false);
      void savePending(kept);
    },
    forget: () => {
      setPending(null);
      void savePending(null);
    },
    hideBanner: () => { setBannerHidden(true); },
  }));
  return <QuestionContext value={{ pending, bannerHidden, ...api }}>{children}</QuestionContext>;
}

/** Q-U2: the quiet Home banner after "Not yet". */
export function MonzoBanner() {
  const question = useMonzoQuestion();
  const p = question.pending;
  if (!p?.later || question.bannerHidden) return null;
  // A new banner (a new question) is a new action: its Yes records once (Q-F1).
  return <Banner key={JSON.stringify(p)} pending={p} />;
}

function Banner({ pending }: { pending: PendingMonzo }) {
  const question = useMonzoQuestion();
  const toast = useToast();
  const people = usePeople();
  const [rowId] = useState(newId);
  // Taps after the first (a double tap) do nothing more.
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const from = people.list.find((x) => x.id === pending.from);
  const to = people.list.find((x) => x.id === pending.to);
  const sentenceId = `monzo-banner-${rowId}`;
  // The sentence needs both names: nothing is shown until they are known.
  if (!from || !to) return null;

  const yes = () => {
    if (done.current) return;
    let id: string;
    try {
      id = addSettlement({ id: pending.id ?? rowId, from: pending.from, to: pending.to, amount: pence(pending.amount), date: pending.date, note: pending.note, method: 'monzo' });
    } catch (err) {
      setError(plainError(err));
      return;
    }
    done.current = true;
    question.forget();
    tickSettled();
    toast.show({
      message: strings.settle.settled,
      action: { label: strings.entry.undo, onAction: () => { deleteSettlement(id); } },
      duration: 5000,
    });
  };

  return (
    <section aria-labelledby={sentenceId} className="bg-surface border-line flex flex-col gap-3 rounded-[16px] border px-4 py-3">
      <p id={sentenceId} className="m-0 break-words">
        {strings.settle.banner(from.name, to.name, formatPence(pence(pending.amount)))}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="plain" onClick={yes}>{strings.settle.yes}</Button>
        <Button variant="plain" onClick={question.hideBanner}>{strings.settle.notYet}</Button>
        <Button variant="quiet" onClick={question.forget}>{strings.settle.forgetIt}</Button>
      </div>
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
    </section>
  );
}

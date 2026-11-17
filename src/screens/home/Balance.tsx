/**
 * The balance on Home (BAL-1…BAL-6, SET-5; DESIGN §4.1): the plank with the two animals, tilted toward
 * whoever is owed; the sentence with names; "Next one's on Sam"; Settle up. Offline it says so and both
 * animals are sleepy. Settling to zero plays the one orchestrated moment: the plank levels, both hop, a few
 * leaves fall once (about 1.2 s, skippable by touching anything, nothing under reduced motion).
 */
import { useEffect, useRef, useState } from 'react';
import { useBalance, useHousehold, useSettlements, type BalanceView } from '../../data';
import { tickSettled } from '../../ui/haptics';
import { Button, useToast } from '../../ui/primitives';
import { Plank, type PlankSeat } from '../../ui/rig/Plank';
import { usePrefersReducedMotion } from '../../ui/rig/motion';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { balanceWords } from '../shared/words';
import { useSheets } from '../sheets';
import { shareInvite } from '../shared/invite';
import './moment.css';

const MOMENT_MS = 1200;

/** True for about 1.2 s after a settle-up brings the balance to zero (SET-5). */
function useAllSquareMoment(balance: BalanceView): [boolean, () => void] {
  const settlements = useSettlements().data;
  const live = settlements?.filter((s) => s.deleted_at === null).length ?? 0;
  const prev = useRef<{ square: boolean; live: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const square = balance.status === 'ready' && balance.state.kind === 'square';
  const known = balance.status === 'ready' && settlements !== undefined;
  useEffect(() => {
    if (!known) return;
    const was = prev.current;
    prev.current = { square, live };
    if (was && !was.square && square && live > was.live) {
      setPlaying(true);
      tickSettled();
    }
  }, [known, square, live]);
  useEffect(() => {
    if (!playing) return;
    const stop = () => { setPlaying(false); };
    const timer = setTimeout(stop, MOMENT_MS);
    // Skippable by touching anything.
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', stop);
    };
  }, [playing]);
  return [playing, () => { setPlaying(false); }];
}

function Leaves() {
  return (
    <div aria-hidden="true" className="moment-leaves">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <svg key={i} className={`moment-leaf moment-leaf-${String(i)}`} viewBox="0 0 20 12" width="20" height="12">
          <path d="M1 6C5 0 14 0 19 6C14 12 5 12 1 6Z" />
          <path d="M3 6H17" className="moment-vein" />
        </svg>
      ))}
    </div>
  );
}

export function BalanceRegion() {
  const balance = useBalance();
  const people = usePeople();
  const sheets = useSheets();
  const household = useHousehold().data;
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const [moment] = useAllSquareMoment(balance);
  const [a, b] = people.list;
  const me = people.me;

  let left: PlankSeat = { kind: a?.animal ?? me?.animal ?? 'cat', mood: 'calm' };
  let right: PlankSeat = { kind: b?.animal ?? (left.kind === 'cat' ? 'dog' : 'cat'), mood: 'calm' };
  let leftNet = 0;
  let sentence: { words: string; amount: string | null } | null = null;
  let turn: string | null = null;
  let owes = false;
  let offline = false;

  if (balance.status === 'ready') {
    leftNet = balance.nets[balance.members[0]] ?? 0;
    sentence = balanceWords(balance.state, people.name);
    turn = balance.nextOneOn ? strings.home.nextOneOn(people.name(balance.nextOneOn)) : null;
    offline = balance.offline;
    owes = balance.state.kind === 'owes';
    if (balance.state.kind === 'owes') {
      const { debtor } = balance.state;
      left = { ...left, mood: balance.members[0] === debtor ? 'sheepish' : 'pleased' };
      right = { ...right, mood: balance.members[1] === debtor ? 'sheepish' : 'pleased' };
    } else {
      left = { ...left, mood: 'happy' };
      right = { ...right, mood: 'happy' };
    }
    if (offline) {
      left = { ...left, mood: 'sleepy' };
      right = { ...right, mood: 'sleepy' };
    }
  } else if (balance.status === 'waiting-for-partner') {
    left = { kind: me?.animal ?? 'cat', mood: 'calm' };
    right = { kind: left.kind === 'cat' ? 'dog' : 'cat', mood: 'sleepy' };
  }
  const square = balance.status === 'ready' && balance.state.kind === 'square';

  return (
    <section aria-label={strings.home.balance} className="relative flex flex-col items-center gap-1 text-center">
      <Plank left={left} right={right} leftNetPence={leftNet} together={square} hop={moment} />
      {moment && !reduced ? <Leaves /> : null}
      {/* One line kept for "offline", so the sentence never moves when the connection comes and goes. */}
      <p className="text-caption text-ink-2 m-0 h-[1.1rem]">{offline ? strings.home.offline : null}</p>
      {balance.status === 'waiting-for-partner' ? (
        <>
          <p className="text-sentence m-0 max-w-[22ch] text-balance">{strings.home.waiting}</p>
          <p className="text-secondary text-ink-2 mt-1 mb-0 max-w-[32ch]">{strings.home.waitingLine}</p>
          <div className="mt-3 flex min-h-11 items-center">
            <Button
              variant="plain"
              onClick={() => {
                if (household?.join_code) void shareInvite(household.join_code, () => { toast.show({ message: strings.settings.copied }); });
              }}
            >
              {strings.home.shareInvite}
            </Button>
          </div>
        </>
      ) : balance.status === 'error' ? (
        <p className="text-note m-0 max-w-[32ch]">{strings.home.balanceHidden}</p>
      ) : (
        <>
          <p className="text-sentence m-0 min-h-[2.75rem] max-w-full break-words text-balance">
            {sentence ? (
              <>
                {sentence.words}
                {sentence.amount ? <span className="text-amount whitespace-nowrap">{sentence.amount}</span> : null}
              </>
            ) : null}
          </p>
          {/* The turn line and Settle up keep their place when hidden, so nothing below jumps (DESIGN §6). */}
          <p className="text-note text-ink-2 m-0 min-h-[1.6rem]">{turn}</p>
          <div className="mt-2 flex min-h-11 items-center">
            {owes ? (
              <Button variant="plain" onClick={() => { sheets.openSettle({ mode: 'new' }); }}>
                {strings.home.settleUp}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

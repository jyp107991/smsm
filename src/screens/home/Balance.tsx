/**
 * The balance on Home (BAL-1…BAL-6, SET-5; DESIGN §4.1): the plank with the two animals, tilted toward
 * whoever is owed; the sentence with names; "Next one's on Sam"; Settle up. Offline it says so in one quiet
 * pill under the plank (with what is waiting to sync) and both animals are sleepy. Settling to zero plays
 * the one orchestrated moment: the plank levels, then both hop, a few leaves fall once and the sentence says
 * "All square" (about 1.2 s, skippable by touching anything, nothing under reduced motion).
 *
 * The sentence is where focus goes when a sheet's opener has gone (Q-U4: Settle up, after "All square"), so
 * a closing sheet never drops focus into a text box and brings the keyboard up.
 */
import { CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBalance, useHousehold, useOnline, useSettlements, useSyncStatus, type BalanceView } from '../../data';
import { registerFocusFallback } from '../../ui/focus';
import { tickSettled } from '../../ui/haptics';
import { plankTilt } from '../../ui/plank';
import { Button, ICON, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { Plank, type PlankSeat } from '../../ui/rig/Plank';
import { usePrefersReducedMotion } from '../../ui/rig/motion';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { balanceWords } from '../shared/words';
import { useSheets } from '../sheets';
import { shareInvite } from '../shared/invite';
import './moment.css';

const MOMENT_MS = 1200;

/**
 * True for about 1.2 s after a settle-up brings the balance to zero (SET-5). The time starts once the plank
 * is level (`levelling` false), so the hop and the leaves follow the plank rather than race it.
 */
function useAllSquareMoment(balance: BalanceView, levelling: boolean): boolean {
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
    if (!playing || levelling) return;
    const stop = () => { setPlaying(false); };
    const timer = setTimeout(stop, MOMENT_MS);
    // Skippable by touching anything.
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', stop);
    };
  }, [playing, levelling]);
  return playing && !levelling;
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

/** The words under the plank: what the balance says, the turn line, and whether Settle up is offered. */
interface Said {
  sentence: { words: string; amount: string | null } | null;
  turn: string | null;
  owes: boolean;
  square: boolean;
}

/** How long the words wait for the plank at most, if it never reports coming to rest (a hidden tab). */
const LEVEL_PATIENCE_MS = 900;

/**
 * Q-L8: in the settle moment the sentence changes when the plank lands. When the balance comes square from
 * a tilt (and the plank swings), the words from before stay until the plank reports it is level; at any
 * other time they follow the balance at once.
 */
function useSaidWhenLevel(said: Said, tilt: number, swings: boolean): { shown: Said; levelling: boolean; landed: () => void } {
  const key = JSON.stringify(said);
  const [held, setHeld] = useState<Said | null>(null);
  const [last, setLast] = useState<{ key: string; said: Said; tilt: number }>({ key, said, tilt });
  if (last.key !== key || last.tilt !== tilt) {
    if (swings && said.square && !last.said.square && last.tilt !== 0 && tilt === 0) setHeld(last.said);
    else if (!said.square) setHeld(null);
    setLast({ key, said, tilt });
  }
  const levelling = held !== null;
  useEffect(() => {
    if (!levelling) return;
    const timer = setTimeout(() => { setHeld(null); }, LEVEL_PATIENCE_MS);
    return () => { clearTimeout(timer); };
  }, [levelling]);
  return { shown: held ?? said, levelling, landed: () => { setHeld(null); } };
}

/**
 * Q-L10 (BAL-5, OFF-5): one quiet pill under the plank says what this phone can't do yet: "Offline",
 * "Offline · 1 waiting to sync", or online "3 changes waiting to sync" while they go. A persistent live
 * region, so each change is announced; its place is kept when empty, so nothing below it moves.
 */
function SyncPill() {
  const online = useOnline();
  const { waiting, updating } = useSyncStatus();
  const Icon = !online ? CloudOff : updating ? RefreshCw : CloudUpload;
  const words = !online
    ? (waiting > 0 ? strings.sync.offlineWaiting(waiting) : strings.home.offline)
    : updating ? strings.sync.updating
    : waiting > 0 ? strings.sync.waiting(waiting) : null;
  return (
    <div className="flex min-h-7 max-w-full items-center justify-center">
      <p role="status" className="m-0 max-w-full">
        {words ? (
          <span className="bg-sunk text-caption text-ink-2 inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-left">
            <Icon size={15} strokeWidth={ICON.stroke} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0">{words}</span>
          </span>
        ) : null}
      </p>
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
  const { otherWindow } = useSyncStatus();
  const [a, b] = people.list;
  const me = people.me;

  let left: PlankSeat = { kind: a?.animal ?? me?.animal ?? 'cat', mood: 'calm' };
  let right: PlankSeat = { kind: b?.animal ?? (left.kind === 'cat' ? 'dog' : 'cat'), mood: 'calm' };
  let leftNet = 0;
  const said: Said = { sentence: null, turn: null, owes: false, square: false };

  if (balance.status === 'ready') {
    leftNet = balance.nets[balance.members[0]] ?? 0;
    said.sentence = balanceWords(balance.state, people.name);
    said.turn = balance.nextOneOn ? strings.home.nextOneOn(people.name(balance.nextOneOn)) : null;
    said.owes = balance.state.kind === 'owes';
    said.square = balance.state.kind === 'square';
    if (balance.state.kind === 'owes') {
      const { debtor } = balance.state;
      left = { ...left, mood: balance.members[0] === debtor ? 'sheepish' : 'pleased' };
      right = { ...right, mood: balance.members[1] === debtor ? 'sheepish' : 'pleased' };
    } else {
      left = { ...left, mood: 'happy' };
      right = { ...right, mood: 'happy' };
    }
    if (balance.offline) {
      left = { ...left, mood: 'sleepy' };
      right = { ...right, mood: 'sleepy' };
    }
  } else if (balance.status === 'waiting-for-partner') {
    left = { kind: me?.animal ?? 'cat', mood: 'calm' };
    right = { kind: left.kind === 'cat' ? 'dog' : 'cat', mood: 'sleepy' };
  }
  const { shown, levelling, landed } = useSaidWhenLevel(said, plankTilt(leftNet), !reduced);
  const moment = useAllSquareMoment(balance, levelling);

  // The sentence takes focus when a sheet's opener has gone (src/ui/focus.ts).
  const sentenceRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => (sentenceRef.current ? registerFocusFallback(sentenceRef.current) : undefined), [balance.status]);
  // Settle up goes once the balance is square; if it had focus, focus moves to the sentence, not the page.
  const settleFocused = useRef(false);
  const settleRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!shown.owes && settleFocused.current) {
      settleFocused.current = false;
      sentenceRef.current?.focus();
    }
  }, [shown.owes]);

  return (
    <section aria-label={strings.home.balance} className="relative flex flex-col items-center gap-1 text-center">
      <Plank left={left} right={right} leftNetPence={leftNet} together={said.square} hop={moment} onRest={(t) => { if (t === 0) landed(); }} />
      {moment && !reduced ? <Leaves /> : null}
      <SyncPill />
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
          <p
            ref={sentenceRef}
            tabIndex={-1}
            className={cx(
              'text-sentence m-0 min-h-[2.75rem] max-w-full rounded-[8px] break-words text-pretty outline-offset-4',
              shown.square && 'text-moss',
            )}
          >
            {shown.sentence ? (
              <>
                {shown.sentence.words}
                {shown.sentence.amount ? <span className="text-amount whitespace-nowrap">{shown.sentence.amount}</span> : null}
              </>
            ) : null}
          </p>
          {/* The turn line and Settle up keep their place when hidden, so nothing below jumps (DESIGN §6). */}
          <p className="text-note text-ink-2 m-0 min-h-[1.6rem]">{shown.turn}</p>
          <div className="mt-2 flex min-h-11 items-center">
            {shown.owes ? (
              <Button
                ref={settleRef}
                variant="plain"
                disabled={otherWindow}
                onFocus={() => { settleFocused.current = true; }}
                onBlur={() => {
                  // Cleared a beat later, so a button removed while it has focus still hands focus on.
                  setTimeout(() => { if (document.activeElement !== settleRef.current) settleFocused.current = false; }, 0);
                }}
                onClick={() => { sheets.openSettle({ mode: 'new' }); }}
              >
                {strings.home.settleUp}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Sign in (PPL-1, OFF-4; DESIGN §4.10): the plank with both animals, the mark and "smsm", one line, then
 * email → a 6-digit emailed code. Errors say what happened and what to do in plain words; offline it says the
 * first sign-in needs a connection.
 *
 * S2 polish Q-L5: the screen carries the brand (the level plank above the name; on the code step the dog is
 * curious), the field and button sit on the 20 px margin, and there is no example address. The code field
 * has focus as soon as the code is sent and signs in by itself when the sixth digit arrives, typed or pasted.
 */
import { useRef, useState, type SyntheticEvent } from 'react';
import { ApiError, sendCode, verifyCode } from '../../data';
import { Logo } from '../../ui/Logo';
import { Button, Field } from '../../ui/primitives';
import { Plank } from '../../ui/rig/Plank';
import { strings } from '../../ui/strings';
import { plainError } from '../shared/plain';
import { CODE_LENGTH, CodeField } from './CodeField';

function plain(err: unknown, step: 'send' | 'verify'): string {
  if (err instanceof ApiError && err.kind !== 'network') {
    if (err.status === 429 || /rate|too many|security purposes/i.test(err.message)) return strings.signIn.tooMany;
    // Sign-ups are closed once both people have joined: an email the server doesn't know is refused.
    if (step === 'send' && /signups? not allowed|signup[s_ ]*disabled/i.test(err.message)) return strings.signIn.closed;
    if (step === 'send' && /email/i.test(err.message) && err.kind === 'refused') return strings.signIn.badEmail;
  }
  return plainError(err, step === 'verify' ? strings.signIn.wrongCode : strings.signIn.failed);
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Sending a code and checking one are tracked apart, in refs as well as state, so a press that arrives
  // while either runs sees it at once (state would only show it on the next render).
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const sendingNow = useRef(false);
  const checkingNow = useRef(false);
  /** The digits as they are now, typed or pasted, even while an earlier set is being checked. */
  const latest = useRef('');
  const busy = sending || checking;

  const send = async (e?: SyntheticEvent) => {
    e?.preventDefault();
    // Not while a code is being sent or checked: a new code would make the one being checked stale.
    if (sendingNow.current || checkingNow.current) return;
    const address = email.trim();
    if (address === '') {
      setError(strings.signIn.emailFirst);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(strings.signIn.badEmail);
      return;
    }
    sendingNow.current = true;
    setSending(true);
    setError(null);
    try {
      await sendCode(address);
      if (sentTo !== null) setNote(strings.signIn.sentAgain);
      setSentTo(address);
      setCode('');
      latest.current = '';
    } catch (err) {
      setError(plain(err, 'send'));
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  };

  /**
   * Checks a code. One check at a time: digits changed while one runs are kept (`latest`) and checked when
   * it settles; its own answer is then out of date and not shown.
   */
  const verify = async (digits: string): Promise<void> => {
    if (sentTo === null || sendingNow.current || checkingNow.current) return;
    if (digits.length !== CODE_LENGTH) {
      setError(strings.signIn.wrongCode);
      return;
    }
    checkingNow.current = true;
    setChecking(true);
    setError(null);
    let failed: string | null = null;
    try {
      await verifyCode(sentTo, digits);
    } catch (err) {
      failed = plain(err, 'verify');
    }
    checkingNow.current = false;
    // Signed in: the session keeper moves the app on to setup or Home; stay busy until it does.
    if (failed === null) return;
    if (latest.current !== digits) {
      if (latest.current.length === CODE_LENGTH) {
        await verify(latest.current);
        return;
      }
      setChecking(false);
      return;
    }
    setError(failed);
    setChecking(false);
  };

  /** Typed or pasted: the sixth digit signs in by itself. */
  const typed = (digits: string) => {
    latest.current = digits;
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH && digits !== code) void verify(digits);
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-6 [@media(min-height:720px)]:py-10">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 [@media(min-height:720px)]:gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Plank left={{ kind: 'cat', mood: 'happy' }} right={{ kind: 'dog', mood: sentTo === null ? 'happy' : 'curious' }} leftNetPence={0} together />
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <h1 className="text-wordmark m-0 text-[2.5rem] leading-none">{strings.app.name}</h1>
          </div>
          <p className="text-note text-ink-2 m-0">{strings.app.tagline}</p>
        </div>
        {sentTo === null ? (
          <form onSubmit={(e) => void send(e)} noValidate className="flex flex-col gap-4">
            <Field
              label={strings.signIn.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="send"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
            />
            {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
            <Button type="submit" block loading={busy}>{strings.signIn.sendCode}</Button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void verify(code); }} noValidate className="flex flex-col gap-4">
            <p className="m-0 break-words">{strings.signIn.sentTo(sentTo)}</p>
            <CodeField value={code} onChange={typed} invalid={error !== null} autoFocus />
            {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
            {note && !error ? <p role="status" className="text-secondary text-ink-2 m-0">{note}</p> : null}
            <Button type="submit" block loading={busy}>{strings.signIn.signIn}</Button>
            <div className="flex flex-wrap justify-center gap-x-2">
              <Button variant="quiet" onClick={() => void send()}>{strings.signIn.sendAgain}</Button>
              <Button variant="quiet" onClick={() => { setSentTo(null); setCode(''); setError(null); setNote(null); }}>
                {strings.signIn.otherEmail}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

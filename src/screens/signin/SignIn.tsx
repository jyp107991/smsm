/**
 * Sign in (PPL-1, OFF-4; DESIGN §4.10): the mark and "smsm", one line, then email → a 6-digit emailed code.
 * Errors say what happened and what to do in plain words; offline it says the first sign-in needs a connection.
 */
import { useState, type SyntheticEvent } from 'react';
import { ApiError, sendCode, verifyCode } from '../../data';
import { Logo } from '../../ui/Logo';
import { Button, Field } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { plainError } from '../shared/plain';
import { CODE_LENGTH, CodeField } from './CodeField';

function plain(err: unknown, step: 'send' | 'verify'): string {
  if (err instanceof ApiError && err.kind !== 'network') {
    if (err.status === 429 || /rate|too many|security purposes/i.test(err.message)) return strings.signIn.tooMany;
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
  const [busy, setBusy] = useState(false);

  const send = async (e?: SyntheticEvent) => {
    e?.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(strings.signIn.badEmail);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendCode(address);
      if (sentTo !== null) setNote(strings.signIn.sentAgain);
      setSentTo(address);
      setCode('');
    } catch (err) {
      setError(plain(err, 'send'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (sentTo === null) return;
    if (code.length !== CODE_LENGTH) {
      setError(strings.signIn.wrongCode);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(sentTo, code);
      // Signed in: the session keeper moves the app on to setup or Home.
    } catch (err) {
      setError(plain(err, 'verify'));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={72} />
        <h1 className="text-wordmark m-0 text-[2.5rem] leading-none">{strings.app.name}</h1>
        <p className="text-note m-0">{strings.app.tagline}</p>
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
            placeholder={strings.signIn.emailPlaceholder}
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
          />
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button type="submit" block loading={busy}>{strings.signIn.sendCode}</Button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)} noValidate className="flex flex-col gap-4">
          <p className="m-0 break-words">{strings.signIn.sentTo(sentTo)}</p>
          <CodeField value={code} onChange={(c) => { setCode(c); setError(null); }} invalid={error !== null} />
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          {note && !error ? <p role="status" className="text-secondary text-ink-2 m-0">{note}</p> : null}
          <Button type="submit" block loading={busy}>{strings.signIn.signIn}</Button>
          <div className="flex flex-wrap justify-center gap-x-4">
            <Button variant="quiet" onClick={() => void send()}>{strings.signIn.sendAgain}</Button>
            <Button variant="quiet" onClick={() => { setSentTo(null); setCode(''); setError(null); setNote(null); }}>
              {strings.signIn.otherEmail}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}

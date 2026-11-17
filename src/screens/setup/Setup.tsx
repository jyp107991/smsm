/**
 * Setup (PPL-1, PPL-2, PPL-3; DESIGN §4.10): start the household or join it with the partner's code, then a
 * name (1–24 characters, any script) and an animal. The partner's animal is taken and says whose it is.
 * All of it needs a connection and says so in plain words (OFF-4).
 */
import { useState, type SyntheticEvent, type ReactNode } from 'react';
import {
  ApiError, createHousehold, EntryInvalidError, joinHousehold, NAME_MAX, OfflineError, setIdentity,
} from '../../data';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Logo } from '../../ui/Logo';
import { Button, Field } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { AnimalPicker } from '../shared/AnimalPicker';
import { usePeople } from '../shared/people';

function message(err: unknown): string {
  if (err instanceof OfflineError) return err.message;
  if (err instanceof EntryInvalidError) return err.reasons.join(' ');
  if (err instanceof ApiError) {
    if (err.kind === 'network') return strings.errors.offline;
    if (/two people/i.test(err.message)) return strings.setup.full;
    if (/too many wrong codes/i.test(err.message)) return strings.setup.tooManyCodes;
    if (/no household with that code/i.test(err.message)) return strings.setup.noSuchCode;
    if (/already picked/i.test(err.message)) return strings.setup.animalTaken;
  }
  return strings.errors.cantLoad;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-5 py-10">
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <span className="text-wordmark text-[1.75rem] leading-none">{strings.app.name}</span>
      </div>
      {children}
    </main>
  );
}

/** Not in a household yet: start one, or join with a code. */
export function StartOrJoin() {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'start' | 'join' | null>(null);

  const start = async () => {
    setBusy('start');
    setError(null);
    try {
      await createHousehold();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const join = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (code.trim() === '') return;
    setBusy('join');
    setError(null);
    try {
      const id = await joinHousehold(code);
      if (id === null) setError(strings.setup.noSuchCode);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <h1 className="text-title m-0">{strings.setup.title}</h1>
        <p className="text-note text-ink-2 m-0">{strings.setup.line}</p>
      </div>
      {joining ? (
        <form onSubmit={(e) => void join(e)} noValidate className="flex flex-col gap-4">
          <Field
            label={strings.setup.joinCode}
            hint={strings.setup.joinHint}
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={holdEnterWhileComposing}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="[&_input]:tracking-[0.2em]"
          />
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          <Button type="submit" block loading={busy === 'join'}>{strings.setup.joinButton}</Button>
          <Button variant="quiet" onClick={() => { setJoining(false); setError(null); }}>{strings.setup.back}</Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Button block loading={busy === 'start'} onClick={() => void start()}>{strings.setup.start}</Button>
          <Button variant="plain" block onClick={() => { setJoining(true); setError(null); }}>{strings.setup.join}</Button>
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
        </div>
      )}
    </Frame>
  );
}

/** In a household, name and animal not set yet (PPL-3). */
export function WhoAreYou() {
  const people = usePeople();
  const partner = people.rows.find((m) => m.user_id !== people.myRow?.user_id && m.animal !== null);
  const a = partner?.animal;
  const partnerAnimal: 'cat' | 'dog' | null = a === 'cat' || a === 'dog' ? a : null;
  const takenBy = partner && partnerAnimal ? { name: partner.display_name ?? '', animal: partnerAnimal } : null;
  const [name, setName] = useState('');
  const [animal, setAnimal] = useState<'cat' | 'dog' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = animal !== null && animal !== takenBy?.animal ? animal : null;

  const done = async (e?: SyntheticEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || Array.from(trimmed).length > NAME_MAX) {
      setError(strings.setup.nameRequired);
      return;
    }
    if (chosen === null) {
      setError(strings.setup.pickAnimal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setIdentity(trimmed, chosen);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <h1 className="text-title m-0">{strings.setup.whoTitle}</h1>
        <p className="text-note text-ink-2 m-0">{strings.setup.whoLine}</p>
      </div>
      <form onSubmit={(e) => void done(e)} noValidate className="flex flex-col gap-6">
        <Field
          label={strings.setup.name}
          hint={strings.setup.nameHint}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={holdEnterWhileComposing}
          autoComplete="nickname"
          enterKeyHint="done"
          {...(error === strings.setup.nameRequired ? { error } : {})}
        />
        <AnimalPicker value={chosen} onChange={(a) => { setAnimal(a); setError(null); }} takenBy={takenBy} />
        {error && error !== strings.setup.nameRequired ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
        <Button type="submit" block loading={busy}>{strings.setup.done}</Button>
      </form>
    </Frame>
  );
}

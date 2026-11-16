import { strings } from '../../ui/strings';
import { build } from '../../data/build';
import { Logo } from '../../ui/Logo';

/** The installable app before sign-in exists (S0). Replaced by sign-in in S2. */
export function Shell() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <Logo size={96} />
      <h1 className="text-[1.75rem] leading-tight font-semibold">{strings.app.name}</h1>
      <p className="text-ink-2">{strings.app.tagline}</p>
      <p className="text-ink-2 text-[0.9375rem]">{strings.app.comingSoon}</p>
      <p className="text-ink-2 mt-8 text-[0.8125rem]" data-testid="version">
        {strings.app.version(build.version, build.commit)}
      </p>
    </main>
  );
}

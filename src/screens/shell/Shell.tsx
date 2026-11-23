import { useBootDone } from '../../ui/boot';
import { strings } from '../../ui/strings';
import { build } from '../../data/build';
import { Logo } from '../../ui/Logo';

/** Shown only by a build with no household server configured (and not the demo): the app can't start. */
export function Shell() {
  useBootDone();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
      <Logo size={88} />
      <h1 className="text-wordmark mt-5 mb-0 text-[2.75rem] leading-none">{strings.app.name}</h1>
      <p className="text-note mt-3 mb-0">{strings.app.tagline}</p>
      <p className="text-secondary text-ink-2 border-line mt-8 mb-0 border-t pt-4">{strings.errors.notConfigured}</p>
      <p className="text-caption text-ink-2 mt-10 mb-0" data-testid="version">
        {strings.app.version(build.version, build.commit)}
      </p>
    </main>
  );
}

/** The S0 design gallery (DESIGN §7). Demo build only; the owner chooses logo and type here and confirms the palette. */
import { ColourSection } from './sections/Colour';
import { InUseSection } from './sections/InUse';
import { LogoSection, PlankSection, RigSection } from './sections/Look';
import { Animal } from '../../ui/rig/Animal';
import { JAE } from '../../../tests/fixtures/household';

export default function Gallery() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-5 py-6">
      <header>
        <h1 className="text-[1.75rem] leading-tight font-semibold">smsm gallery</h1>
        <p className="text-ink-2">Choices to make before the app is built on them.</p>
      </header>
      <LogoSection />
      <ColourSection />
      <PlankSection />
      <RigSection />
      <InUseSection head={(who) => <Animal kind={who === JAE ? 'dog' : 'cat'} pose="head" size={24} motion={false} title={who === JAE ? 'Jae paid' : 'Sam paid'} />} />
    </main>
  );
}

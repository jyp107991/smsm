/** The S0 design gallery (DESIGN §7). Demo build only; the owner chooses the mark and the type here and confirms the palette. */
import { ColourSection } from './sections/Colour';
import { InUseSection } from './sections/InUse';
import { TypeSection } from './sections/Type';
import { LogoSection, PlankSection, RigSection } from './sections/Look';
import { Animal } from '../../ui/rig/Animal';
import { Logo } from '../../ui/Logo';
import { JAE } from '../../../tests/fixtures/household';

export default function Gallery() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-14 px-5 pt-10 pb-16">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <h1 className="text-wordmark m-0 text-[2.25rem] leading-none">smsm</h1>
        </div>
        <p className="text-note m-0 max-w-[34ch]">Three things to choose: the mark, the letters and the fifth colour. The rest is here to look at.</p>
      </header>
      <LogoSection />
      <TypeSection />
      <ColourSection />
      <PlankSection />
      <RigSection />
      <InUseSection head={(who) => <Animal kind={who === JAE ? 'dog' : 'cat'} pose="head" size={24} motion={false} title={who === JAE ? 'Jae paid' : 'Sam paid'} />} />
    </main>
  );
}

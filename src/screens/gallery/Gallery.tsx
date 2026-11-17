/**
 * The design gallery (DESIGN §7). Demo build only. The owner's choices are made (DECISIONS, 17 Nov: mark C,
 * letters A, bottle green), so it shows what was chosen, not the options: the palette, the plank, the two
 * animals and the screens on the page, with previews of the screens the demo can't reach (Previews.tsx).
 */
import { ColourSection } from './sections/Colour';
import { InUseSection } from './sections/InUse';
import { PlankSection, RigSection } from './sections/Look';
import { PreviewPage, previewOf } from './Previews';
import { Animal } from '../../ui/rig/Animal';
import { Logo } from '../../ui/Logo';
import { JAE } from '../../../tests/fixtures/household';

export default function Gallery() {
  const preview = previewOf(location.pathname);
  if (preview) return <PreviewPage slug={preview} />;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-14 px-5 pt-10 pb-16">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <h1 className="text-wordmark m-0 text-[2.25rem] leading-none">smsm</h1>
        </div>
        <p className="text-note m-0 max-w-[34ch]">How smsm looks, by day and by night.</p>
      </header>
      <ColourSection />
      <PlankSection />
      <RigSection />
      <InUseSection head={(who) => <Animal kind={who === JAE ? 'dog' : 'cat'} pose="head" size={24} motion={false} title={who === JAE ? 'Jae paid' : 'Sam paid'} />} />
    </main>
  );
}

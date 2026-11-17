import { useEffect, useState, type ReactNode } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { CalendarDays, ChartNoAxesColumn, House, List, type LucideIcon } from 'lucide-react';
import { strings } from '../strings';
import { cx, ICON } from './util';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

export type MainTab = 'home' | 'activity' | 'bills' | 'insights';

/** The four tabs along the bottom (DESIGN §4): Home · Activity · Bills · Insights. */
export const MAIN_TABS: readonly TabItem<MainTab>[] = [
  { value: 'home', label: strings.tabs.home, icon: House },
  { value: 'activity', label: strings.tabs.activity, icon: List },
  { value: 'bills', label: strings.tabs.bills, icon: CalendarDays },
  { value: 'insights', label: strings.tabs.insights, icon: ChartNoAxesColumn },
];

function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(el.type);
}

/** How much shorter the visible page must be than the tallest seen at this width to be a keyboard, in px. */
const KEYBOARD_PX = 150;

/**
 * True while the on-screen keyboard is really open (S2 polish Q-U4): a text field has focus on a touch
 * screen and the visual viewport is clearly shorter than the tallest it has been at this width (index.html
 * sets `interactive-widget=resizes-content`, so the keyboard shrinks the page). Focus alone is not enough:
 * a hardware keyboard, or a field focused before the keyboard rises, leaves the tab bar where it is.
 * The tallest height is kept per width and forgotten when the phone turns, so turning it doesn't read as a
 * keyboard; it is compared with what has been seen rather than `screen.height`, which some browsers shrink
 * with the viewport. Heights are taken at the page's scale, so pinch-zoom doesn't read as a keyboard either.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const viewport = window.visualViewport;
    const tallest = new Map<number, number>();
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // After focusout, activeElement is only settled on the next frame.
      frame = requestAnimationFrame(() => {
        const width = Math.round(window.innerWidth);
        // At the page's own scale: pinch-zoom shrinks the visual viewport too, and that isn't a keyboard.
        const height = viewport ? viewport.height * viewport.scale : window.innerHeight;
        const most = Math.max(tallest.get(width) ?? 0, height);
        tallest.set(width, most);
        setOpen(coarse.matches && isTextEntry(document.activeElement) && most - height > KEYBOARD_PX);
      });
    };
    // Turned on its side, the phone has a new tallest height; what was seen before no longer counts.
    // (Older browsers and test pages have no screen.orientation; they still send orientationchange.)
    const orientation = (screen as { orientation?: ScreenOrientation }).orientation;
    let facedType = orientation?.type;
    let facedWidth = Math.round(window.innerWidth);
    // Only a real turn counts (the orientation and the width both change): some browsers send the event
    // for any resize, the keyboard's included.
    const turned = () => {
      const type = orientation?.type;
      const width = Math.round(window.innerWidth);
      if (type !== facedType && width !== facedWidth) tallest.clear();
      facedType = type;
      facedWidth = width;
      update();
    };
    update();
    orientation?.addEventListener('change', turned);
    window.addEventListener('orientationchange', turned);
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      orientation?.removeEventListener('change', turned);
      window.removeEventListener('orientationchange', turned);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}

export interface BottomTabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** <TabPanel> elements, one per item. They are wrapped in the page's <main>. */
  children: ReactNode;
  className?: string;
}

/**
 * The app's bottom navigation (Radix Tabs). The bar has a 3 px walnut top edge, sits in thumb reach,
 * respects the home indicator, and hides while the keyboard is open. The tabs sit together in the middle
 * (Q-L4), each at most 7 rem wide, rather than spread to the screen's edges. A tap shows no focus box; the
 * keyboard's focus is a rounded ring on the tab's pill.
 */
export function BottomTabs<T extends string>({ items, value, onValueChange, children, className }: BottomTabsProps<T>) {
  const keyboard = useKeyboardOpen();
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const item = items.find((i) => i.value === next);
        if (item) onValueChange(item.value);
      }}
      activationMode="automatic"
      className={cx('flex min-h-dvh flex-col', className)}
    >
      {/* The page's main landmark: screens inside a tab panel do not add their own <main>. */}
      <main className="min-w-0 flex-1">{children}</main>
      <nav
        aria-label={strings.tabs.label}
        hidden={keyboard}
        // Toasts sit above the bar, never on it.
        data-toast-avoid=""
        className="border-walnut bg-paper sticky bottom-0 z-30 border-t-[3px] pb-[env(safe-area-inset-bottom)]"
      >
        <RadixTabs.List className="flex justify-center px-2">
          {items.map(({ value: v, label, icon: Icon }) => (
            <RadixTabs.Trigger
              key={v}
              value={v}
              // Radix focuses a tab from script as the pointer goes down, which browsers then draw as keyboard
              // focus: a ring after every tap. Taps choose the tab on click instead, without moving focus.
              onMouseDown={(e) => { if (e.button === 0 && !e.ctrlKey) e.preventDefault(); }}
              // Tapping the tab you are on still goes to its top page (from Settings back to Home).
              onClick={() => { onValueChange(v); }}
              className={cx(
                'group text-ink-2 flex min-h-16 max-w-28 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5',
                'transition-colors duration-150 hover:text-ink data-[state=active]:text-forest',
                // The ring goes on the pill, not round the whole tab.
                'outline-none focus-visible:outline-none',
              )}
            >
              <span
                className={cx(
                  'flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,transform] duration-150',
                  'group-hover:bg-sunk group-data-[state=active]:bg-sunk group-active:scale-[0.96]',
                  'group-focus-visible:outline-forest group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-solid',
                )}
              >
                <Icon size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="group-data-[state=active]:stroke-[2.25]" />
              </span>
              <span className="text-caption max-w-full truncate font-medium group-data-[state=active]:font-semibold">{label}</span>
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
      </nav>
    </RadixTabs.Root>
  );
}

/** One tab's content. Unselected panels are unmounted (Radix default). */
export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Content value={value} className={cx('outline-none', className)}>
      {children}
    </RadixTabs.Content>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** Names the group for screen readers (e.g. "How it's split"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * Choose one of a few (Radix ToggleGroup, single: a radio group with arrow-key movement), e.g.
 * "Split · Exact · For Sam · My treat". One is always chosen: pressing the chosen one again does nothing.
 * Selected is a raised surface tile in the sunk track, with forest text (same weight, so nothing moves);
 * outlines are for keyboard focus only (S2 polish Q-L2).
 */
export function Segmented<T extends string>({ label, options, value, onValueChange, className }: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      className={cx('bg-sunk flex w-full min-w-0 gap-1 rounded-[12px] p-1', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cx(
            // Widths follow the labels; when four don't fit on one line (320 px), labels wrap between
            // words ("For / Sam") rather than being cut, and the row grows taller together.
            'text-secondary text-ink min-h-11 flex-auto rounded-[9px] px-2 py-1 leading-tight font-medium text-balance',
            'transition-[background-color,color] duration-150 hover:text-forest',
            'data-[state=on]:bg-surface data-[state=on]:text-forest',
          )}
        >
          <span className="block">{o.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

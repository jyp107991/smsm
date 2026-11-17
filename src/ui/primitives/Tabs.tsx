import type { ReactNode } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { CalendarDays, ChartNoAxesColumn, House, List, type LucideIcon } from 'lucide-react';
import { useKeyboardOpen } from '../keyboard';
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

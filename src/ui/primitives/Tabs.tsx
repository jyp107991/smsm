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

/**
 * True while a text field has focus on a touch screen, i.e. while the on-screen keyboard is very likely
 * open. (With `interactive-widget=resizes-content` the keyboard shrinks the page, so a bar that stayed
 * would take a large share of what is left.)
 */
function useTypingOnTouch(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // After focusout, activeElement is only settled on the next frame.
      frame = requestAnimationFrame(() => {
        setTyping(coarse.matches && isTextEntry(document.activeElement));
      });
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return typing;
}

export interface BottomTabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** <TabPanel> elements, one per item. */
  children: ReactNode;
  className?: string;
}

/**
 * The app's bottom navigation (Radix Tabs). The bar has a 3 px walnut top edge, sits in thumb reach,
 * respects the home indicator, and hides while the keyboard is open.
 */
export function BottomTabs<T extends string>({ items, value, onValueChange, children, className }: BottomTabsProps<T>) {
  const typing = useTypingOnTouch();
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
      <div className="min-w-0 flex-1">{children}</div>
      <RadixTabs.List
        aria-label={strings.tabs.label}
        hidden={typing}
        className="border-walnut bg-paper sticky bottom-0 z-30 flex border-t-[3px] pb-[env(safe-area-inset-bottom)]"
      >
        {items.map(({ value: v, label, icon: Icon }) => (
          <RadixTabs.Trigger
            key={v}
            value={v}
            className={cx(
              'group text-ink-2 flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5',
              'data-[state=active]:text-forest',
              'focus-visible:-outline-offset-4',
            )}
          >
            <span className="group-data-[state=active]:bg-sunk flex h-8 w-14 items-center justify-center rounded-full">
              <Icon size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="group-data-[state=active]:stroke-[2.25]" />
            </span>
            <span className="text-caption max-w-full truncate font-medium group-data-[state=active]:font-semibold">{label}</span>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
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
 * Selected shows as a forest outline on a raised segment, with forest, bolder text.
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
            'text-secondary text-ink min-h-11 min-w-0 flex-1 rounded-[9px] border-2 border-transparent px-1.5 font-medium',
            'data-[state=on]:border-forest data-[state=on]:bg-surface data-[state=on]:text-forest data-[state=on]:font-semibold',
          )}
        >
          <span className="block truncate">{o.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

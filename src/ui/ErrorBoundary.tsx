import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reporter } from '../data/reporting';
import { strings } from './strings';

interface State { failed: boolean }

/** Last line of defence: report the crash, then offer a reload in plain words (DESIGN §5). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    void reporter.report(error, location.pathname, { componentStack: info.componentStack ?? null });
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
        <p>{strings.errors.generic}</p>
        <button
          type="button"
          className="bg-forest text-on-forest min-h-11 self-start rounded-full px-5 font-semibold"
          onClick={() => { location.reload(); }}
        >
          {strings.errors.reload}
        </button>
      </main>
    );
  }
}

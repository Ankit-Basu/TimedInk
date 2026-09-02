import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence.
 *
 * TanStack Query already surfaces *fetch* failures through each view's error
 * state; this catches the other kind — a render-time throw from a bad
 * assumption about a payload. Without it React unmounts the whole tree and the
 * user gets a white page with nothing to act on.
 *
 * Still a class component: `getDerivedStateFromError` has no hook equivalent.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // In a real deployment this is where Sentry (or equivalent) would be called.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full items-center justify-center p-3 sm:p-5">
        <div className="frame w-full max-w-lg p-10">
          <p className="label mb-4">Something broke</p>
          <h1 className="display text-3xl">
            That page hit an error
            <br />
            <span className="text-ink-3 italic">and stopped rendering.</span>
          </h1>

          <p className="mt-5 text-[13px] leading-relaxed text-ink-2">
            Your scheduled emails are unaffected — the queue runs in a separate process and
            nothing here touches it. Reloading usually clears this.
          </p>

          <pre className="mono mt-5 max-h-40 overflow-auto border-l-2 border-rule-strong bg-surface-2 py-3 pl-4 text-xs whitespace-pre-wrap text-ink-2">
            {error.message}
          </pre>

          <div className="mt-6 flex gap-3">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

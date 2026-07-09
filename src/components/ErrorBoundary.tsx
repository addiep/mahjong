/**
 * A crash while rendering the Board or ScorePanel used to unmount the whole
 * app, dropping the player back to a blank page mid-hand with no way to
 * recover short of a manual reload (external codebase review finding 14,
 * 2026-07-09: no React error boundaries anywhere). This catches render
 * errors in its subtree and shows a small recoverable message instead.
 *
 * Deliberately narrow: it only catches errors thrown during render/commit of
 * its children (React's error boundary contract), not errors in event
 * handlers or async code -- those are already caught individually at their
 * call sites (see the try/catch blocks in useLocalGame.ts's dispatch calls).
 */

import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Custom fallback renderer; defaults to a small inline message + reset button. */
  readonly fallback?: ((error: Error, reset: () => void) => ReactNode) | undefined;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#eee' }}>
        <p>Something went wrong displaying the game.</p>
        <button type="button" onClick={this.reset}>Try again</button>
      </div>
    );
  }
}

export default ErrorBoundary;

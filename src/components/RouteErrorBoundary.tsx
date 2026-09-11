import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface FallbackProps {
  error: Error;
  onReset: () => void;
}

/**
 * Full-page fallback shown when a route's component tree throws during render.
 * Kept intentionally dependency-light so it can render even when app-level
 * providers/hooks are the thing that failed.
 */
function RouteErrorFallback({ error, onReset }: FallbackProps) {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-foreground">This page hit a snag</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong while rendering this page. You can try again, or head back to a
          working page.
        </p>
        {import.meta.env.DEV && (
          <pre className="text-left text-xs bg-muted text-muted-foreground rounded-md p-3 overflow-auto max-h-48">
            {error.message}
          </pre>
        )}
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={onReset}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.assign('/')}
            className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Changing this value resets the boundary (used to recover on navigation). */
  resetKey: string;
  onReset: () => void;
  /** Rendered instead of the full-page fallback — use `null` for chrome that
   * should fail silently rather than replace the page. */
  fallback?: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    // Navigating to a different route clears a prior error so the new page
    // gets a clean render instead of staying stuck on the fallback.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the real cause in the console for diagnosis.
    console.error('[RouteErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if ('fallback' in this.props) return <>{this.props.fallback}</>;
      return (
        <RouteErrorFallback
          error={this.state.error}
          onReset={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Wraps the routed page tree in an error boundary that recovers on navigation.
 * Without this, any error thrown while a page renders unmounts the whole React
 * tree and leaves a blank white page (previously seen intermittently on heavier
 * pages such as /simulation-lab).
 */
export default function RouteErrorBoundary({
  children,
  ...rest
}: { children: ReactNode } & Partial<Pick<BoundaryProps, 'fallback'>>) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ErrorBoundaryInner
      resetKey={location.pathname}
      onReset={() => navigate(0)}
      {...rest}
    >
      {children}
    </ErrorBoundaryInner>
  );
}

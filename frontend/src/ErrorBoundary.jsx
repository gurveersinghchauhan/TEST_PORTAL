import { Component } from 'react';

/**
 * ErrorBoundary
 * -------------
 * React only unmounts the WHOLE tree on an uncaught render error if nothing
 * catches it — which is exactly what was producing the blank white screen
 * when result/report data came back incomplete (e.g. a force-submitted
 * submission with a missing/malformed field). Wrapping a subtree here means
 * a crash inside it degrades to a small inline error message instead of
 * taking down the entire dashboard.
 *
 * Usage: <ErrorBoundary fallbackMessage="Couldn't load this report.">
 *          <ReportModal ... />
 *        </ErrorBoundary>
 * `resetKey` (optional) — when it changes, the boundary clears its error
 * state so re-opening on a different item (e.g. a different student's
 * report) gets a fresh render attempt instead of staying stuck on the last
 * crash.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught a render error:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
            <p className="text-sm font-medium text-rose-700">
              {this.props.fallbackMessage || 'Something went wrong displaying this.'}
            </p>
            <p className="mt-1 text-xs text-rose-500">
              {this.props.showDetails && this.state.error ? String(this.state.error.message || this.state.error) : ''}
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

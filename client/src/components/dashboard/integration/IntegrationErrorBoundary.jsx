import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class IntegrationErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[IntegrationErrorBoundary] Caught render error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-[var(--color-bg)] text-[var(--color-text)]">
          <div className="w-12 h-12 rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] flex items-center justify-center mb-4">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-base font-semibold mb-2 text-[var(--color-text)]">
            Something went wrong in the Integration Test view
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-6 leading-relaxed">
            A temporary render error occurred while updating the test scenarios. Your generated data is safe in the project.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary)]/90 transition-colors cursor-pointer shadow-sm"
            >
              <RefreshCw size={14} />
              Retry & Reload Workspace
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Refresh Page
            </button>
          </div>

          {this.state.error && (
            <details className="mt-8 text-left max-w-xl w-full bg-[var(--color-surface)] p-3 rounded border border-[var(--color-border)] text-xs font-mono text-[var(--color-text-secondary)]">
              <summary className="cursor-pointer text-[var(--color-danger)] font-semibold mb-2">
                Error details: {this.state.error.message || String(this.state.error)}
              </summary>
              <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap leading-tight text-[var(--color-text-muted)]">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

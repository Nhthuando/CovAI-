import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export class ZoneErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[ZoneErrorBoundary: ${this.props.zoneTitle || "Zone"}]`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="w-full rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-6 text-[var(--ud-text)] flex flex-col items-center justify-center text-center gap-3 my-2"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]">
            <AlertTriangle size={20} />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--ud-text)]">
              Failed to load {this.props.zoneTitle || "this section"}
            </h4>
            <p className="text-xs text-[var(--ud-text-muted)] max-w-md font-mono">
              {this.state.error?.message || "An unexpected error occurred while rendering."}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] hover:border-[var(--ud-text-muted)] transition-colors cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ZoneErrorBoundary;

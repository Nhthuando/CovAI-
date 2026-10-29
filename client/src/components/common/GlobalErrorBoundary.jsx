import React from "react";
import { AlertTriangle, RefreshCw, Home, Copy, Check } from "lucide-react";

export default class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[GlobalErrorBoundary] Uncaught application error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopy = () => {
    const errorDetails = `${this.state.error?.message}\n\nStack:\n${this.state.error?.stack || ""}\n\nComponent Stack:\n${this.state.errorInfo?.componentStack || ""}`;
    navigator.clipboard.writeText(errorDetails);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0F14] text-[#E6EDF3] flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl p-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-5">
              <AlertTriangle size={28} />
            </div>

            <h1 className="text-xl font-bold text-white mb-2">
              Application Encountered an Error
            </h1>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed max-w-md">
              A component error prevented this view from rendering. Your project files and test data remain completely safe.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer shadow-md"
              >
                <RefreshCw size={15} />
                Refresh Page
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = "/projects";
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-gray-200 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
              >
                <Home size={15} />
                Back to Projects
              </button>
              <button
                type="button"
                onClick={this.handleCopy}
                className="flex items-center gap-2 px-3 py-2 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-gray-300 rounded-lg text-sm transition-colors cursor-pointer"
                title="Copy error details"
              >
                {this.state.copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{this.state.copied ? "Copied" : "Copy Error"}</span>
              </button>
            </div>

            {this.state.error && (
              <details className="w-full text-left bg-[#0D1117] border border-[#30363D] rounded-lg p-3.5 text-xs font-mono text-gray-400 overflow-hidden">
                <summary className="cursor-pointer text-red-400 font-semibold mb-2 select-none hover:text-red-300">
                  {this.state.error.name}: {this.state.error.message}
                </summary>
                <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed text-gray-400 max-h-48 whitespace-pre-wrap">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

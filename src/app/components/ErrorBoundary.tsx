import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors in its subtree and shows a recoverable fallback
 * instead of a white screen. Wrap top-level pages or risky subtrees with this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console in dev; wire to an external logger (Sentry, etc.) later.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);

    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-[#0B0F17]/80 p-6 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-bold text-white text-base tracking-tight">Something broke</h2>
          </div>
          <p className="text-sm text-[#8b92a8] mb-4 leading-relaxed">
            This section crashed while rendering. The rest of the app still works.
          </p>
          <pre className="mb-4 max-h-40 overflow-auto rounded-lg border border-[#1a1f2e] bg-[#05070B] p-3 text-[11px] text-[#8b92a8] whitespace-pre-wrap break-words">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="flex items-center gap-2 rounded-lg bg-[#00FFA3] px-4 py-2 text-xs font-bold text-black transition-all hover:scale-105 hover:bg-[#33ffb5]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}

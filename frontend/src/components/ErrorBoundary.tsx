import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Catches render errors in a route so a single page crash doesn't blank the app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced to the console for debugging; could ship to a logger later.
    console.error("UI error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card grid place-items-center p-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={22} />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Something went wrong on this screen</h2>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <div className="mt-4 flex gap-2">
            <button className="btn-ghost" onClick={() => this.setState({ error: null })}>
              <RotateCcw size={16} /> Try again
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

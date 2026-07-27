import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback (e.g. tab name) */
  label?: string;
  /** Called when user clicks "Try again" — remounts children */
  onReset?: () => void;
  /** Compact layout for embedding inside a tab panel */
  compact?: boolean;
}

interface State {
  error: Error | null;
  resetKey: number;
}

/**
 * Catches render errors so one broken tab/page cannot blank the whole app.
 * Especially important with tab keep-alive + TanStack Router hooks that throw
 * "Invariant failed" when their route is no longer the active match.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    try {
      // Soft recover: clear tab crash by going to planning via full navigation
      window.location.hash = "";
      window.history.replaceState(null, "", "/planning");
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  render() {
    const { error, resetKey } = this.state;
    if (error) {
      const message = error.message || String(error);
      const isInvariant = /invariant failed/i.test(message);

      return (
        <div
          className={
            this.props.compact
              ? "flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
              : "flex h-full min-h-[240px] flex-col items-center justify-center gap-4 p-8 text-center"
          }
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="max-w-md space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              {this.props.label
                ? `Something went wrong in ${this.props.label}`
                : "Something went wrong"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isInvariant
                ? "A tab lost its router match (keep-alive conflict). Try again or reload — you should not need to reopen the app."
                : "This view crashed. You can retry without restarting Badami."}
            </p>
            <p className="mt-2 break-all rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] text-muted-foreground/80">
              {message}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="default" className="gap-1.5" onClick={this.handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={this.handleReload}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reload app
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={this.handleGoHome}>
              <Home className="h-3.5 w-3.5" />
              Go to Planning
            </Button>
          </div>
        </div>
      );
    }

    // resetKey forces children to remount after "Try again"
    return <Fragment key={resetKey}>{this.props.children}</Fragment>;
  }
}

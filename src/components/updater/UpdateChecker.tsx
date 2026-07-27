import { useEffect } from "react";
import { Download, Loader2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppUpdater } from "@/hooks/useAppUpdater";

interface UpdateCheckerProps {
  /** Check once on mount (e.g. About page). Default false. */
  checkOnMount?: boolean;
  /** Compact layout for Settings rows. */
  compact?: boolean;
  className?: string;
}

/**
 * UI for checking / installing updates from GitHub Releases.
 */
export function UpdateChecker({
  checkOnMount = false,
  compact = false,
  className,
}: UpdateCheckerProps) {
  const {
    status,
    version,
    notes,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
  } = useAppUpdater();

  useEffect(() => {
    if (checkOnMount) {
      void checkForUpdates({ silent: true });
    }
  }, [checkOnMount, checkForUpdates]);

  const busy =
    status === "checking" ||
    status === "downloading" ||
    status === "installing";

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn(
          "flex items-center gap-3",
          compact ? "justify-between" : "flex-col sm:flex-row sm:justify-between",
        )}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          {status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Check GitHub for a newer release
            </p>
          )}
          {status === "checking" && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking for updates…
            </p>
          )}
          {status === "up-to-date" && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              You&apos;re on the latest version
            </p>
          )}
          {status === "available" && (
            <div>
              <p className="text-sm font-medium text-foreground">
                Update available: v{version}
              </p>
              {notes && (
                <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">
                  {notes}
                </p>
              )}
            </div>
          )}
          {(status === "downloading" || status === "installing") && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {status === "downloading"
                  ? `Downloading${progress != null ? ` ${progress}%` : "…"}`
                  : "Installing…"}
              </p>
              {progress != null && (
                <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {status === "error" && error && (
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status === "available" ? (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => void downloadAndInstall()}
            >
              <Download className="h-3.5 w-3.5" />
              Download & Install
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={() => void checkForUpdates()}
            >
              {status === "checking" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for Updates
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

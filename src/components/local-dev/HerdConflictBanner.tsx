import { useState } from "react";
import { AlertOctagon, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocalDevStore } from "@/stores/localDevStore";
import { cn } from "@/lib/utils";
import { HERD_ROLE_LABELS, hasHerdConflict } from "@/types/localDev";

/**
 * Warns when Herd is **running**, not merely installed.
 *
 * Those are different facts with different consequences: installed Herd is the
 * data source Badami imports from, while running Herd is a hard conflict — two
 * nginx masters on one port, and two servers on one MariaDB datadir, which the
 * InnoDB guard refuses. The old header text ("Herd inventory detected") blurred
 * the two, so a start failure looked mysterious.
 */
export function HerdConflictBanner() {
  const herdStatus = useLocalDevStore((s) => s.herdStatus);
  const herdBusy = useLocalDevStore((s) => s.herdBusy);
  const loadHerdStatus = useLocalDevStore((s) => s.loadHerdStatus);
  const quitHerd = useLocalDevStore((s) => s.quitHerd);
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!hasHerdConflict(herdStatus) || !herdStatus) return null;

  const services = herdStatus.processes.filter((p) => p.role !== "app");
  const heldPorts = herdStatus.ports.filter((p) => p.listening && p.attributed_role);
  const orphaned = !herdStatus.app_running && services.length > 0;

  return (
    <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-900 dark:text-red-100">
      <div className="flex flex-wrap items-start gap-2">
        <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {orphaned ? "Herd services are still running" : "Herd is running"}
          </p>
          <p className="mt-0.5 text-red-800/90 dark:text-red-200/90">
            {services.length > 0
              ? `${services.length} Herd service process${services.length === 1 ? "" : "es"} alive`
              : "Herd.app is active"}
            {heldPorts.length > 0 && (
              <>
                {" · holding "}
                {heldPorts.map((p) => `:${p.port}`).join(", ")}
              </>
            )}
            . Badami cannot bind the same ports, and starting MariaDB on the same
            datadir is refused by the InnoDB guard.
          </p>

          {(services.length > 0 || herdStatus.notes.length > 0) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Hide details" : "What is running?"}
            </button>
          )}

          {expanded && (
            <div className="mt-2 space-y-1.5">
              {services.map((p) => (
                <div
                  key={p.pid}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-red-500/20 bg-background/40 px-2 py-1.5"
                >
                  <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">
                    {HERD_ROLE_LABELS[p.role]}
                  </Badge>
                  <span className="shrink-0 font-mono text-[10px] opacity-70">pid {p.pid}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] opacity-60">
                    {p.command}
                  </span>
                </div>
              ))}
              {orphaned && (
                <p className="text-[11px] text-red-800/90 dark:text-red-200/90">
                  Herd.app itself is not running, so a quit request cannot stop
                  these. Launch Herd and stop its services there, or reboot.
                  Badami will not signal them — killing a live mysqld risks the
                  datadir you are trying to reuse.
                </p>
              )}
              {herdStatus.notes.slice(0, 3).map((n, i) => (
                <p key={i} className="text-[10px] opacity-70">
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={herdBusy}
            onClick={() => void loadHerdStatus()}
          >
            <RefreshCw className="h-3 w-3" />
            Recheck
          </Button>
          {herdStatus.app_running && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={herdBusy}
              onClick={() => setConfirmOpen(true)}
            >
              {herdBusy && <Loader2 className="h-3 w-3 animate-spin" />}
              Quit Herd
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quit Herd?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>
                  Badami asks <strong>Herd.app</strong> to quit the same way you would
                  from its menu bar, then waits for its services to stop. Herd shuts
                  down its own MariaDB cleanly this way.
                </p>
                <p>
                  No signal is sent to any service process — force-killing a live
                  <code className="mx-1 font-mono">mysqld</code> risks the datadir
                  Badami is about to reuse. If something survives, you will be told
                  rather than have Badami escalate.
                </p>
                <p className="text-muted-foreground">
                  Any site currently served by Herd will stop responding until you
                  start Badami&apos;s stack.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction className="text-xs" onClick={() => void quitHerd()}>
              Quit Herd
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

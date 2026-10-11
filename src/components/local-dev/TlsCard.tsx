import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { TrustCaResult } from "@/types/localDev";

/**
 * TLS panel inside Settings. Covers two orthogonal things:
 *
 *   1. **The local CA** — exists on disk? trusted in the System keychain?
 *      Trusting it is the one admin-prompt step that makes `https://*.test`
 *      not warn in every browser. Per-site certs are useless without this.
 *
 *   2. **Secured sites** — a read-only listing of what currently has a leaf
 *      cert on disk + the `BADAMI_SECURED=1` marker in its nginx conf. The
 *      actual Secure / Unsecure toggle lives on each site row in `SitesPanel`;
 *      duplicating it here would create two sources of truth.
 */
export function TlsCard() {
  const tlsStatus = useLocalDevStore((s) => s.tlsStatus);
  const tlsBusy = useLocalDevStore((s) => s.tlsBusy);
  const loadTlsStatus = useLocalDevStore((s) => s.loadTlsStatus);
  const ensureTlsCa = useLocalDevStore((s) => s.ensureTlsCa);
  const trustTlsCa = useLocalDevStore((s) => s.trustTlsCa);

  const [trustOpen, setTrustOpen] = useState(false);
  const [trustPreview, setTrustPreview] = useState<TrustCaResult | null>(null);

  useEffect(() => {
    void loadTlsStatus();
  }, [loadTlsStatus]);

  const status = tlsStatus;
  const caExists = status?.ca_exists ?? false;
  const caTrusted = status?.ca_trusted ?? false;

  const openTrustDialog = async () => {
    // Preview the argv so the user can see exactly what the admin prompt will
    // run. `run=false` keeps `cfg!(test)` happy and never shells out.
    const preview = await trustTlsCa({ run: false });
    if (preview) {
      setTrustPreview(preview);
      setTrustOpen(true);
    }
  };

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-2 pt-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4" />
          TLS · local CA + per-site certs
        </CardTitle>
        <CardDescription className="text-xs">
          Badami issues a local Certificate Authority and uses it to sign leaf
          certs for every secured <code className="font-mono">*.test</code> site.
          Trust the CA once (System keychain) and{" "}
          <code className="font-mono">https://foo.test</code> stops warning. The
          CA key never leaves this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <StatusCell
            ok={caExists}
            title="CA on disk"
            detail={
              status?.ca_cert_path
                ? truncatePath(status.ca_cert_path)
                : "Not yet generated — click Ensure CA"
            }
          />
          <StatusCell
            ok={caTrusted}
            title="CA trusted"
            detail={
              caTrusted
                ? "Already trusted in the System keychain"
                : "https://*.test will warn until this is set"
            }
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={tlsBusy}
            onClick={() => void ensureTlsCa()}
          >
            {tlsBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {caExists ? "Verify CA" : "Ensure CA"}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={tlsBusy || caTrusted}
            onClick={() => void openTrustDialog()}
          >
            {tlsBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            Trust CA…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={tlsBusy}
            onClick={() => void loadTlsStatus()}
          >
            Refresh
          </Button>
        </div>

        {!caTrusted && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Trust CA runs <code className="font-mono">security add-trusted-cert</code> via
              one macOS admin prompt (osascript). Rust composes the argv locally — no
              user-writable script is executed as root. After trusting, Chrome / Safari /
              Firefox accept your leaf certs without warnings.
            </p>
          </div>
        )}

        {status && status.secured_sites.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Secured sites ({status.secured_sites.length})
            </p>
            <ul className="space-y-1">
              {status.secured_sites.map((site) => (
                <li
                  key={`${site.name}.${site.tld}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                  <span className="font-medium">
                    {site.name}.{site.tld}
                  </span>
                  <span
                    className="ml-auto truncate font-mono text-[10px] text-muted-foreground"
                    title={site.cert_path}
                  >
                    {truncatePath(site.cert_path)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {status?.notes && status.notes.length > 0 && (
          <ul className="list-inside list-disc text-[11px] text-muted-foreground">
            {status.notes.slice(0, 4).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={trustOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTrustOpen(false);
            setTrustPreview(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trust the local Badami CA?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>
                  macOS will prompt once for your administrator password. Rust runs the
                  following argv via <code className="font-mono">security(1)</code> through
                  osascript — nothing is interpolated from a shell string.
                </p>
                {trustPreview?.step && (
                  <pre className="max-h-32 overflow-auto rounded bg-[#0d1117] p-2 font-mono text-[10px] text-[#c9d1d9]">
                    {trustPreview.step}
                  </pre>
                )}
                <p className="text-muted-foreground">
                  CA cert path:{" "}
                  <code className="font-mono text-[11px]">
                    {trustPreview?.ca_cert_path ?? status?.ca_cert_path ?? "—"}
                  </code>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs"
              disabled={tlsBusy}
              onClick={() => {
                setTrustOpen(false);
                setTrustPreview(null);
                void trustTlsCa({ run: true });
              }}
            >
              Trust CA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StatusCell({
  ok,
  title,
  detail,
}: {
  ok: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {title}
        {ok && (
          <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">
            ok
          </Badge>
        )}
      </div>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

/**
 * Shorten long cert / key paths for display. Keeps enough of the leaf name
 * that two certs in the same dir are still distinguishable.
 */
function truncatePath(path: string): string {
  if (path.length <= 72) return path;
  // Keep the leaf and show the start of the first path segment.
  const parts = path.split("/");
  if (parts.length <= 2) return `${path.slice(0, 36)}…${path.slice(-32)}`;
  const leaf = parts.slice(-3).join("/");
  const head = parts.slice(0, 2).join("/");
  return `${head}/…/${leaf}`;
}

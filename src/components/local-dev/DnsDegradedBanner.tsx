import { AlertTriangle } from "lucide-react";
import { useLocalDevStore } from "@/stores/localDevStore";

export function DnsDegradedBanner() {
  const dnsDegraded = useLocalDevStore((s) => s.dnsDegraded);
  const services = useLocalDevStore((s) => s.services);
  const discovery = useLocalDevStore((s) => s.discovery);

  if (!dnsDegraded) return null;

  const dns = services.find((s) => s.id === "dnsmasq");
  const reason =
    dns?.status.status === "unhealthy"
      ? dns.status.reason
      : dns?.status.status === "error"
        ? dns.status.message
        : dns?.status.status === "stopped"
          ? "dnsmasq is not running"
          : "DNS service is not healthy";

  const resolverMissing =
    discovery?.resolver && !discovery.resolver.present
      ? ` · resolver file missing (${discovery.resolver.path})`
      : "";

  return (
    <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="font-medium">DNS degraded</p>
        <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/90">
          {reason}
          {resolverMissing}. Sites under your local TLD may not resolve. Start dnsmasq or the full
          stack when ready.
        </p>
      </div>
    </div>
  );
}

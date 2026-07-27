import { AlertTriangle } from "lucide-react";
import { useLocalDevStore } from "@/stores/localDevStore";
import { computeDnsSetup } from "@/types/localDev";

/**
 * Warn only when `*.tld` genuinely does not resolve.
 *
 * This used to key off the dnsmasq **process status** alone, so it announced
 * "sites may not resolve" while resolution demonstrably worked — including when
 * an existing listener (Herd's, Homebrew's) served the TLD, or when the cached
 * spec probed a stale port. Resolution is the capability the user cares about;
 * whose process provides it is not this banner's business.
 */
export function DnsDegradedBanner() {
  const services = useLocalDevStore((s) => s.services);
  const bootstrapStatus = useLocalDevStore((s) => s.bootstrapStatus);
  const dnsProbe = useLocalDevStore((s) => s.dnsProbe);
  const settings = useLocalDevStore((s) => s.settings);

  const dns = computeDnsSetup({ services, bootstrap: bootstrapStatus, probe: dnsProbe });
  if (dns.kind === "healthy" || dns.kind === "adopted") return null;
  // No probe yet means unknown, not broken — do not cry wolf on first paint.
  if (!dnsProbe) return null;

  const tld = settings.tld || dnsProbe.tld || "test";
  const port = Number(settings.http_port || 8080);

  const reason = (() => {
    switch (dns.kind) {
      case "port_mismatch":
        return `${dnsProbe.resolver_path} points at port ${dns.resolverPort} but dnsmasq.conf binds ${dns.confPort}`;
      case "no_resolver":
        return `${dns.resolverPath} is missing, so macOS never asks dnsmasq`;
      case "no_binary":
        return "no dnsmasq binary was found";
      case "not_running":
        return "dnsmasq is not running";
      default:
        return dnsProbe.error || "the resolve probe failed";
    }
  })();

  return (
    <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="font-medium">
          {`*.${tld} is not resolving`}
        </p>
        <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/90">
          {reason}. Sites still work at{" "}
          <span className="font-mono">
            http://127.0.0.1:{port}
          </span>{" "}
          with a Host header. Fix DNS from the Services tab.
        </p>
      </div>
    </div>
  );
}

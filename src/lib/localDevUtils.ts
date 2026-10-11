/**
 * Pure Local Dev helpers — no Tauri / DOM / Zustand imports.
 *
 * Kept in a dedicated file so unit tests can exercise them without pulling in
 * the full store (which requires the Tauri IPC bridge at import time).
 */

/**
 * Build the browser URL for a site.
 *
 * Mirrors `plan-local-dev.md § "Site URL builder"`: port `80` is elided so a
 * privileged (Mode B) install shows `http://foo.test`, everything else keeps
 * the `:{port}` suffix (Mode A default is `:8080`).
 *
 * The `tld` is used verbatim — it must already be the TLD without a leading
 * dot ("test", not ".test"). No IDN / percent-encoding is applied because
 * Local Dev sites are always ASCII directory names on disk.
 */
export function siteUrl(name: string, tld: string, httpPort: number): string {
  const host = `${name}.${tld}`;
  if (httpPort === 80) return `http://${host}`;
  return `http://${host}:${httpPort}`;
}

/**
 * HTTPS variant used when a site has `BADAMI_SECURED=1` and both cert files
 * on disk. Port `443` is elided like `siteUrl` elides `:80`.
 */
export function siteHttpsUrl(name: string, tld: string, httpsPort: number): string {
  const host = `${name}.${tld}`;
  if (httpsPort === 443) return `https://${host}`;
  return `https://${host}:${httpsPort}`;
}

/**
 * Prefix the Rust `open_site_url_at_with_probe` returns when the DNS probe
 * fails and the caller did not pass `force=true`. Must match exactly:
 * `src-tauri/src/commands/local_dev/sites.rs::DNS_UNHEALTHY_PREFIX`.
 */
export const DNS_UNHEALTHY_PREFIX = "DNS_UNHEALTHY:";

/**
 * Pull the human message out of a `DNS_UNHEALTHY: …` error string.
 *
 * Returns `null` when the input is not a DNS-unhealthy error, so the caller
 * can fall through to its generic error path. The returned detail has the
 * prefix and any surrounding whitespace stripped.
 */
export function parseDnsUnhealthyError(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!text) return null;
  if (!text.startsWith(DNS_UNHEALTHY_PREFIX)) return null;
  return text.slice(DNS_UNHEALTHY_PREFIX.length).trim();
}

/**
 * True when the given error carries the DNS-unhealthy prefix. Convenience
 * wrapper so callers can gate without discarding the detail message.
 */
export function isDnsUnhealthyError(err: unknown): boolean {
  return parseDnsUnhealthyError(err) !== null;
}

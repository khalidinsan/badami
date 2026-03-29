// ─── cURL Command Generator ──────────────────────────────────────────

interface CurlOptions {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string | null;
  authType: string;
}

function shellEscape(s: string): string {
  if (!/[^a-zA-Z0-9_./:@%+=,-]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Generate a cURL command string from request parameters.
 * Credential-linked values ({{CRED:...}}) are masked as `***`.
 */
export function generateCurl(opts: CurlOptions): string {
  const parts: string[] = ["curl"];

  // Method (skip -X for GET since it's default)
  if (opts.method !== "GET") {
    parts.push(`-X ${opts.method}`);
  }

  // URL — mask credential references
  parts.push(shellEscape(maskCredentials(opts.url)));

  // Headers
  for (const h of opts.headers) {
    const val = maskCredentials(h.value);
    parts.push(`-H ${shellEscape(`${h.key}: ${val}`)}`);
  }

  // Body
  if (opts.body && opts.method !== "GET" && opts.method !== "HEAD") {
    const masked = maskCredentials(opts.body);
    parts.push(`-d ${shellEscape(masked)}`);
  }

  return parts.join(" \\\n  ");
}

const CRED_RE = /\{\{CRED:[^}]+\}\}/g;

function maskCredentials(s: string): string {
  return s.replace(CRED_RE, "***");
}

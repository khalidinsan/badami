import { useEffect, useRef } from "react";
import { useCredentialStore } from "@/stores/credentialStore";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * Check credential expiry dates on app startup (once per session).
 * Sends OS notifications for credentials expiring within 30/7/1 days.
 */
export function useExpiryCheck() {
  const hasChecked = useRef(false);
  const { credentials, loadAllCredentials, loading, loaded } = useCredentialStore();

  useEffect(() => {
    if (hasChecked.current) return;
    if (loading) return;

    // Load if not loaded yet
    if (!loaded) {
      loadAllCredentials();
      return;
    }

    hasChecked.current = true;
    checkExpiry(credentials);
  }, [credentials, loading, loaded, loadAllCredentials]);
}

interface ExpiringItem {
  name: string;
  expiresAt: string;
  daysUntil: number;
}

async function checkExpiry(
  credentials: { name: string; expires_at: string | null }[],
) {
  const now = new Date();
  const expiring: ExpiringItem[] = [];

  for (const cred of credentials) {
    if (!cred.expires_at) continue;
    const expiryDate = new Date(cred.expires_at);
    const diff = expiryDate.getTime() - now.getTime();
    const daysUntil = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (daysUntil <= 30) {
      expiring.push({
        name: cred.name,
        expiresAt: cred.expires_at,
        daysUntil,
      });
    }
  }

  if (expiring.length === 0) return;

  // Request notification permission
  let permGranted = await isPermissionGranted();
  if (!permGranted) {
    const perm = await requestPermission();
    permGranted = perm === "granted";
  }
  if (!permGranted) return;

  // Group by urgency and send one notification per group
  const expired = expiring.filter((e) => e.daysUntil <= 0);
  const critical = expiring.filter(
    (e) => e.daysUntil > 0 && e.daysUntil <= 1,
  );
  const warning = expiring.filter(
    (e) => e.daysUntil > 1 && e.daysUntil <= 7,
  );
  const notice = expiring.filter(
    (e) => e.daysUntil > 7 && e.daysUntil <= 30,
  );

  if (expired.length > 0) {
    sendNotification({
      title: `${expired.length} credential${expired.length > 1 ? "s" : ""} expired`,
      body: expired
        .slice(0, 3)
        .map((e) => e.name)
        .join(", ") + (expired.length > 3 ? ` +${expired.length - 3} more` : ""),
    });
  }

  if (critical.length > 0) {
    sendNotification({
      title: `${critical.length} credential${critical.length > 1 ? "s" : ""} expiring tomorrow`,
      body: critical
        .slice(0, 3)
        .map((e) => e.name)
        .join(", ") + (critical.length > 3 ? ` +${critical.length - 3} more` : ""),
    });
  }

  if (warning.length > 0) {
    sendNotification({
      title: `${warning.length} credential${warning.length > 1 ? "s" : ""} expiring within 7 days`,
      body: warning
        .slice(0, 3)
        .map((e) => `${e.name} (${e.daysUntil}d)`)
        .join(", "),
    });
  }

  if (notice.length > 0) {
    sendNotification({
      title: `${notice.length} credential${notice.length > 1 ? "s" : ""} expiring within 30 days`,
      body: notice
        .slice(0, 3)
        .map((e) => `${e.name} (${e.daysUntil}d)`)
        .join(", "),
    });
  }
}

/**
 * Count credentials that are expired or expiring soon (within 30 days).
 */
export function getExpiryBadgeCount(
  credentials: { expires_at: string | null }[],
): number {
  const now = new Date();
  let count = 0;
  for (const cred of credentials) {
    if (!cred.expires_at) continue;
    const expiryDate = new Date(cred.expires_at);
    const diff = expiryDate.getTime() - now.getTime();
    const daysUntil = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (daysUntil <= 30) count++;
  }
  return count;
}

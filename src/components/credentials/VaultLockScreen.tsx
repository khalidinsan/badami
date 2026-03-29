import { useState } from "react";
import { Lock, AlertCircle, Unlock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVault } from "@/hooks/useVault";

export function VaultLockScreen() {
  const { unlockVault, vaultConfig } = useVault();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const handleUnlock = async () => {
    if (!password.trim()) return;
    setError(false);
    setLoading(true);
    try {
      await unlockVault(password);
      setUnlocked(true);
      setPassword("");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <AnimatePresence mode="wait">
        {unlocked ? (
          <motion.div
            key="unlocked"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3"
          >
            <motion.div
              initial={{ rotate: -20 }}
              animate={{ rotate: 0 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10"
            >
              <Unlock className="h-7 w-7 text-green-500" />
            </motion.div>
            <p className="text-sm font-medium text-green-600">Vault Unlocked</p>
          </motion.div>
        ) : (
          <motion.div
            key="locked"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="mx-auto w-full max-w-xs space-y-6 text-center"
          >
            <motion.div
              animate={error ? { x: [0, -8, 8, -6, 6, 0] } : {}}
              transition={{ duration: 0.4 }}
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"
            >
              <Lock className="h-7 w-7 text-primary" />
            </motion.div>
            <div>
              <h2 className="text-lg font-semibold">Vault Locked</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter your master password to unlock credentials
              </p>
            </div>
            <div className="space-y-3">
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleUnlock(); }}
                placeholder="Master password"
                className="h-9 text-sm"
                autoFocus
              />
              {vaultConfig?.password_hint && (
                <p className="text-[11px] text-muted-foreground">
                  Hint: {vaultConfig.password_hint}
                </p>
              )}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center justify-center gap-1.5 text-xs text-destructive"
                  >
                    <AlertCircle className="h-3 w-3" />
                    Wrong password. Try again.
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                onClick={handleUnlock}
                disabled={!password.trim() || loading}
                className="w-full"
                size="sm"
              >
                {loading ? "Unlocking..." : "Unlock Vault"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

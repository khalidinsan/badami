import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Loader2,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Copy,
  Rocket,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface TursoDatabaseCreatorProps {
  onUseDatabase: (url: string, token: string) => void;
}

interface TursoOrg {
  slug: string;
  name: string;
  type: string;
}

interface TursoRegion {
  code: string;
  description: string;
}

type Step = "token" | "configure" | "created";

export function TursoDatabaseCreator({ onUseDatabase }: TursoDatabaseCreatorProps) {
  const [step, setStep] = useState<Step>("token");
  const [platformToken, setPlatformToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 2 data
  const [orgs, setOrgs] = useState<TursoOrg[]>([]);
  const [regions, setRegions] = useState<TursoRegion[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [dbName, setDbName] = useState("badami-sync");
  const [selectedRegion, setSelectedRegion] = useState("");

  // Step 3 data
  const [createdUrl, setCreatedUrl] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [creating, setCreating] = useState(false);

  const handleValidateToken = useCallback(async () => {
    if (!platformToken.trim()) return;
    setLoading(true);
    setError("");
    try {
      const [orgResult, regionResult] = await Promise.all([
        invoke<{ organizations?: TursoOrg[] }>("turso_list_organizations", {
          platformToken: platformToken.trim(),
        }),
        invoke<{ locations?: Record<string, string> }>("turso_list_regions", {
          platformToken: platformToken.trim(),
        }),
      ]);

      const orgList = orgResult.organizations ?? [];
      if (orgList.length === 0) {
        setError("No organizations found for this token.");
        return;
      }
      setOrgs(orgList);
      setSelectedOrg(orgList[0].slug);

      // Transform locations map to array
      const locs = regionResult.locations ?? {};
      const regionList = Object.entries(locs).map(([code, desc]) => ({
        code,
        description: desc as string,
      }));
      setRegions(regionList);
      // Default to sin (Singapore) or first available
      const defaultRegion = regionList.find((r) => r.code === "sin")?.code ?? regionList[0]?.code ?? "";
      setSelectedRegion(defaultRegion);

      setStep("configure");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [platformToken]);

  const handleCreateDatabase = useCallback(async () => {
    if (!selectedOrg || !dbName.trim() || !selectedRegion) return;
    setCreating(true);
    setError("");
    try {
      // Create the database
      const dbResult = await invoke<{ database?: { Hostname?: string; hostname?: string } }>(
        "turso_create_database",
        {
          platformToken: platformToken.trim(),
          orgSlug: selectedOrg,
          dbName: dbName.trim(),
          region: selectedRegion,
        },
      );

      const hostname = dbResult.database?.Hostname ?? dbResult.database?.hostname ?? "";
      const url = hostname ? `libsql://${hostname}` : "";

      if (!url) {
        setError("Database created but could not get URL. Check Turso dashboard.");
        return;
      }

      // Generate auth token for the database
      const tokenResult = await invoke<{ jwt?: string }>("turso_create_token", {
        platformToken: platformToken.trim(),
        orgSlug: selectedOrg,
        dbName: dbName.trim(),
      });

      const jwt = tokenResult.jwt ?? "";
      if (!jwt) {
        setError("Database created but failed to generate token. Generate manually from Turso dashboard.");
        setCreatedUrl(url);
        return;
      }

      setCreatedUrl(url);
      setCreatedToken(jwt);
      setStep("created");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [platformToken, selectedOrg, dbName, selectedRegion]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-500 flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </p>
        </div>
      )}

      {step === "token" && (
        <>
          <p className="text-xs text-muted-foreground">
            Create a new Turso database without leaving the app. You need a{" "}
            <span className="font-medium text-foreground">Platform API token</span> from{" "}
            <span className="font-mono text-primary">turso.tech/app/settings/api-tokens</span>.
          </p>

          <div>
            <Label htmlFor="platform-token" className="text-xs">
              Platform API Token
            </Label>
            <div className="relative mt-1">
              <Input
                id="platform-token"
                type={showToken ? "text" : "password"}
                value={platformToken}
                onChange={(e) => {
                  setPlatformToken(e.target.value);
                  setError("");
                }}
                placeholder="tp-xxxxxxxxxxxxxxxx"
                className="h-8 pr-9 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <Button
            size="sm"
            className="text-xs"
            onClick={handleValidateToken}
            disabled={loading || !platformToken.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="ml-1.5 h-3 w-3" />
              </>
            )}
          </Button>
        </>
      )}

      {step === "configure" && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-green-500">
            <Check className="h-3 w-3" />
            Token verified
          </div>

          <div>
            <Label htmlFor="org" className="text-xs">
              Organization
            </Label>
            <Select value={selectedOrg} onValueChange={setSelectedOrg}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((org) => (
                  <SelectItem key={org.slug} value={org.slug}>
                    {org.name || org.slug}
                    {org.type === "personal" && " (personal)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="db-name" className="text-xs">
              Database Name
            </Label>
            <Input
              id="db-name"
              value={dbName}
              onChange={(e) => {
                setDbName(e.target.value.replace(/[^a-z0-9-]/g, ""));
                setError("");
              }}
              placeholder="badami-sync"
              className="mt-1 h-8 text-sm font-mono"
            />
          </div>

          <div>
            <Label htmlFor="region" className="text-xs">
              Region
            </Label>
            <Select value={selectedRegion} onValueChange={setSelectedRegion}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.description} ({r.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setStep("token")}
            >
              Back
            </Button>
            <Button
              size="sm"
              className="text-xs"
              onClick={handleCreateDatabase}
              disabled={creating || !dbName.trim() || !selectedRegion}
            >
              {creating ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Rocket className="mr-1.5 h-3 w-3" />
                  Create Database
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {step === "created" && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
            <Check className="h-3 w-3" />
            Database created successfully!
          </div>

          <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Database URL</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate text-xs font-mono text-foreground">
                  {createdUrl}
                </code>
                <button
                  onClick={() => copyToClipboard(createdUrl, "URL")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            {createdToken && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Auth Token</p>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 truncate text-xs font-mono text-foreground">
                    {createdToken.slice(0, 32)}...
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdToken, "Token")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setStep("token");
                setPlatformToken("");
                setCreatedUrl("");
                setCreatedToken("");
              }}
            >
              Start Over
            </Button>
            <Button
              size="sm"
              className="text-xs"
              onClick={() => onUseDatabase(createdUrl, createdToken)}
              disabled={!createdUrl || !createdToken}
            >
              <ArrowRight className="mr-1.5 h-3 w-3" />
              Use This Database
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

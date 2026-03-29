import { useState, useEffect, useCallback, useRef } from "react";
import { Settings2, Copy, ShieldOff, Timer, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UrlBar } from "./UrlBar";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { CollectionVariablesEditor } from "./CollectionVariablesEditor";
import { ParamsTab } from "./tabs/ParamsTab";
import { HeadersTab } from "./tabs/HeadersTab";
import { BodyTab } from "./tabs/BodyTab";
import { AuthTab } from "./tabs/AuthTab";
import { ResponsePanel } from "./tabs/ResponsePanel";
import { useApiStore } from "@/stores/apiStore";
import * as apiQueries from "@/db/queries/api";
import { useApiRequest } from "@/hooks/useApiRequest";
import { useEnvironment } from "@/hooks/useEnvironment";
import { generateCurl } from "@/lib/curlExporter";
import { cn } from "@/lib/utils";
import type { HttpMethod, BodyType, AuthType, AuthConfig, KeyValueEntry } from "@/types/api";
import type { ApiRequestRow } from "@/types/db";
import { toast } from "sonner";

interface RequestBuilderProps {
  request: ApiRequestRow;
}

export function RequestBuilder({ request }: RequestBuilderProps) {
  const {
    activeTab,
    setActiveTab,
    responseTab,
    setResponseTab,
    updateRequest,
  } = useApiStore();
  const { response, sending, sendRequest, cancel } = useApiRequest();
  const { environments, activeEnvironment, setActive, reload: reloadEnvs, getVariables } =
    useEnvironment(request.collection_id);
  const [envEditorOpen, setEnvEditorOpen] = useState(false);
  const [colVarsOpen, setColVarsOpen] = useState(false);
  const [envVarNames, setEnvVarNames] = useState<Set<string>>(new Set());
  const [colVarNames, setColVarNames] = useState<Set<string>>(new Set());
  const [varValues, setVarValues] = useState<Map<string, string>>(new Map());
  const [disableSsl, setDisableSsl] = useState(false);
  const [timeout, setTimeout_] = useState(30);

  // Local state for the request fields (edited before save)
  const [method, setMethod] = useState<HttpMethod>(request.method as HttpMethod);
  const [url, setUrl] = useState(request.url);
  const [headers, setHeaders] = useState<KeyValueEntry[]>(() =>
    request.headers ? JSON.parse(request.headers) : [{ key: "", value: "", enabled: true }],
  );
  const [params, setParams] = useState<KeyValueEntry[]>(() =>
    request.params ? JSON.parse(request.params) : [{ key: "", value: "", enabled: true }],
  );
  const [bodyType, setBodyType] = useState<BodyType>(request.body_type as BodyType);
  const [bodyContent, setBodyContent] = useState(request.body_content || "");
  const [authType, setAuthType] = useState<AuthType>(request.auth_type as AuthType);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(() =>
    request.auth_config ? JSON.parse(request.auth_config) : null,
  );

  // Sync local state when request changes
  useEffect(() => {
    setMethod(request.method as HttpMethod);
    setUrl(request.url);
    setHeaders(
      request.headers
        ? JSON.parse(request.headers)
        : [{ key: "", value: "", enabled: true }],
    );
    setParams(
      request.params
        ? JSON.parse(request.params)
        : [{ key: "", value: "", enabled: true }],
    );
    setBodyType(request.body_type as BodyType);
    setBodyContent(request.body_content || "");
    setAuthType(request.auth_type as AuthType);
    setAuthConfig(request.auth_config ? JSON.parse(request.auth_config) : null);
  }, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load environments on mount
  useEffect(() => {
    reloadEnvs();
  }, [request.collection_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load variable names + values for highlighting and hover tooltips
  useEffect(() => {
    const values = new Map<string, string>();
    const envNames = new Set<string>();
    const colNames = new Set<string>();

    Promise.all([
      activeEnvironment
        ? getVariables(activeEnvironment.id).then((vars) => {
            for (const v of vars) {
              if (v.enabled && v.var_key) {
                envNames.add(v.var_key);
                if (v.plain_value != null) values.set(v.var_key, v.plain_value);
                else if (v.credential_id) values.set(v.var_key, "[encrypted]");
              }
            }
          })
        : Promise.resolve(),
      apiQueries.getCollectionVariables(request.collection_id).then((vars) => {
        for (const v of vars) {
          if (v.enabled && v.var_key) {
            colNames.add(v.var_key);
            // Only add to values map if not already set by env (env takes priority)
            if (!values.has(v.var_key)) {
              if (v.plain_value != null) values.set(v.var_key, v.plain_value);
              else if (v.credential_id) values.set(v.var_key, "[encrypted]");
            }
          }
        }
      }),
    ]).then(() => {
      setEnvVarNames(envNames);
      setColVarNames(colNames);
      setVarValues(values);
    });
  }, [activeEnvironment?.id, request.collection_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounced
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoSave = useCallback(() => {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      updateRequest(request.id, {
        method,
        url,
        headers: JSON.stringify(headers),
        params: JSON.stringify(params),
        body_type: bodyType,
        body_content: bodyContent || null,
        auth_type: authType,
        auth_config: authConfig ? JSON.stringify(authConfig) : null,
      });
    }, 500);
  }, [
    request.id,
    method,
    url,
    headers,
    params,
    bodyType,
    bodyContent,
    authType,
    authConfig,
    updateRequest,
  ]);

  useEffect(() => {
    autoSave();
    return () => clearTimeout(saveTimeout.current);
  }, [autoSave]);

  const handleSend = useCallback(async () => {
    // Save first
    await updateRequest(request.id, {
      method,
      url,
      headers: JSON.stringify(headers),
      params: JSON.stringify(params),
      body_type: bodyType,
      body_content: bodyContent || null,
      auth_type: authType,
      auth_config: authConfig ? JSON.stringify(authConfig) : null,
    });

    // Build a "resolved" request row
    const resolved: ApiRequestRow = {
      ...request,
      method,
      url,
      headers: JSON.stringify(headers),
      params: JSON.stringify(params),
      body_type: bodyType,
      body_content: bodyContent || null,
      auth_type: authType,
      auth_config: authConfig ? JSON.stringify(authConfig) : null,
    };

    sendRequest(resolved, activeEnvironment?.id ?? null, {
      disableSslVerify: disableSsl,
      timeoutSeconds: timeout,
    });
  }, [
    request,
    method,
    url,
    headers,
    params,
    bodyType,
    bodyContent,
    authType,
    authConfig,
    activeEnvironment,
    updateRequest,
    sendRequest,
    disableSsl,
    timeout,
  ]);

  const requestTabs = [
    { id: "params" as const, label: "Params", count: params.filter((p) => p.key).length },
    { id: "headers" as const, label: "Headers", count: headers.filter((h) => h.key).length },
    { id: "body" as const, label: "Body", badge: bodyType !== "none" ? bodyType : undefined },
    { id: "auth" as const, label: "Auth", badge: authType !== "none" ? authType : undefined },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Top section: URL bar + environment */}
      <div className="shrink-0 space-y-2 border-b border-white/10 p-3">
        <UrlBar
          method={method}
          url={url}
          sending={sending}
          envVarNames={envVarNames}
          colVarNames={colVarNames}
          varValues={varValues}
          onMethodChange={setMethod}
          onUrlChange={setUrl}
          onSend={handleSend}
          onCancel={cancel}
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Environment:</span>
          <EnvironmentSelector
            environments={environments}
            activeId={activeEnvironment?.id ?? null}
            onSelect={setActive}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Manage environments"
            onClick={() => setEnvEditorOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Collection variables"
            onClick={() => setColVarsOpen(true)}
          >
            <Variable className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>

          {/* SSL toggle */}
          <button
            onClick={() => setDisableSsl(!disableSsl)}
            title={disableSsl ? "SSL verification disabled" : "SSL verification enabled"}
            className={cn(
              "flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors",
              disableSsl
                ? "bg-yellow-500/15 text-yellow-600"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            )}
          >
            <ShieldOff className="h-3 w-3" />
            {disableSsl && "SSL off"}
          </button>

          {/* Timeout */}
          <div className="flex items-center gap-1">
            <Timer className="h-3 w-3 text-muted-foreground/50" />
            <input
              type="number"
              min={1}
              max={300}
              value={timeout}
              onChange={(e) => setTimeout_(Math.max(1, Math.min(300, parseInt(e.target.value) || 30)))}
              className="h-5 w-10 rounded border border-white/10 bg-white/5 px-1 text-center text-[10px] text-muted-foreground outline-none focus:border-[#007AFF]/40"
              title="Timeout (seconds)"
            />
            <span className="text-[10px] text-muted-foreground/40">s</span>
          </div>

          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[10px] text-muted-foreground"
              title="Copy as cURL"
              onClick={() => {
                const enabledHeaders = headers.filter((h) => h.enabled && h.key);
                const curl = generateCurl({
                  method,
                  url,
                  headers: enabledHeaders,
                  body: bodyType !== "none" ? bodyContent : null,
                  authType,
                });
                navigator.clipboard.writeText(curl);
                toast.success("cURL copied to clipboard");
              }}
            >
              <Copy className="h-3 w-3" />
              cURL
            </Button>
          </div>
        </div>
      </div>

      {/* Request tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3">
        {requestTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-[#007AFF]/15 px-1.5 text-[10px] text-[#007AFF]">
                {tab.count}
              </span>
            )}
            {tab.badge && (
              <span className="rounded-full bg-[#007AFF]/15 px-1.5 text-[10px] capitalize text-[#007AFF]">
                {tab.badge}
              </span>
            )}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t bg-[#007AFF]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 shrink-0 overflow-auto" style={{ maxHeight: "40%" }}>
        {activeTab === "params" && (
          <ParamsTab params={params} onChange={setParams} />
        )}
        {activeTab === "headers" && (
          <HeadersTab headers={headers} onChange={setHeaders} />
        )}
        {activeTab === "body" && (
          <BodyTab
            bodyType={bodyType}
            bodyContent={bodyContent}
            onTypeChange={setBodyType}
            onContentChange={setBodyContent}
          />
        )}
        {activeTab === "auth" && (
          <AuthTab
            authType={authType}
            authConfig={authConfig}
            onTypeChange={setAuthType}
            onConfigChange={setAuthConfig}
          />
        )}
      </div>

      {/* Response section */}
      <div className="min-h-0 flex-1 overflow-auto border-t border-white/10">
        <ResponsePanel
          response={response}
          sending={sending}
          activeTab={responseTab}
          onTabChange={setResponseTab}
        />
      </div>

      <EnvironmentEditor
        open={envEditorOpen}
        onClose={() => {
          setEnvEditorOpen(false);
          reloadEnvs();
        }}
        collectionId={request.collection_id}
      />
      <CollectionVariablesEditor
        open={colVarsOpen}
        onClose={() => setColVarsOpen(false)}
        collectionId={request.collection_id}
        collectionName=""
      />
    </div>
  );
}

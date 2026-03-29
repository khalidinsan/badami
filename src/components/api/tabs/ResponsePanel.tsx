import { ResponseViewer } from "../ResponseViewer";
import type { SendRequestResponse } from "@/types/api";
import { getStatusColor, formatBytes } from "@/types/api";
import { cn } from "@/lib/utils";

interface ResponsePanelProps {
  response: SendRequestResponse | null;
  sending: boolean;
  activeTab: "body" | "headers" | "cookies";
  onTabChange: (tab: "body" | "headers" | "cookies") => void;
}

export function ResponsePanel({
  response,
  sending,
  activeTab,
  onTabChange,
}: ResponsePanelProps) {
  if (sending) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
        <p className="mt-3 text-sm text-muted-foreground">Sending request...</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Hit Send to get a response
      </div>
    );
  }

  const isError = response.status === 0;
  const statusColor = isError ? "#ef4444" : getStatusColor(response.status);
  const tabs = ["body", "headers", "cookies"] as const;

  return (
    <div className="flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: statusColor }}
        >
          {isError ? "ERR" : response.status}
        </span>
        <span className="text-xs text-muted-foreground">
          {response.status_text}
        </span>
        {!isError && (
          <>
            <span className="text-xs text-muted-foreground">
              {response.elapsed_ms}ms
            </span>
            <span className="text-xs text-muted-foreground">
              {formatBytes(response.body_size)}
            </span>
          </>
        )}

        {/* Tabs */}
        <div className="ml-auto flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors",
                activeTab === tab
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "body" && (
          <div className="p-2">
            <ResponseViewer body={response.body} />
          </div>
        )}

        {activeTab === "headers" && (
          <div className="p-3">
            {response.headers.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No response headers
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="pb-1 pr-4 font-medium text-muted-foreground">
                      Header
                    </th>
                    <th className="pb-1 font-medium text-muted-foreground">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {response.headers.map((h, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1.5 pr-4 font-mono font-medium text-[#007AFF]">
                        {h.key}
                      </td>
                      <td className="py-1.5 font-mono text-foreground/80">
                        {h.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "cookies" && (
          <div className="p-3">
            {response.cookies.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No cookies received
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="pb-1 pr-4 font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="pb-1 pr-4 font-medium text-muted-foreground">
                      Value
                    </th>
                    <th className="pb-1 font-medium text-muted-foreground">
                      Domain
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {response.cookies.map((c, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1.5 pr-4 font-mono font-medium">
                        {c.name}
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-foreground/80">
                        {c.value}
                      </td>
                      <td className="py-1.5 font-mono text-muted-foreground">
                        {c.domain}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Key } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColumnData {
  name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
}

interface TableNodeData {
  label: string;
  columns: ColumnData[];
}

function TableNodeComponent({ data }: NodeProps<TableNodeData>) {
  return (
    <div className="min-w-[200px] rounded-lg border border-white/15 bg-background/95 shadow-lg backdrop-blur-sm">
      {/* Table header */}
      <div className="rounded-t-lg border-b border-white/10 bg-blue-500/15 px-3 py-1.5">
        <span className="text-xs font-semibold text-blue-400">{data.label}</span>
      </div>

      {/* Columns */}
      <div className="divide-y divide-white/5 py-0.5">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="relative flex items-center gap-1.5 px-3 py-1"
          >
            {/* Handle for incoming edges */}
            <Handle
              type="target"
              position={Position.Left}
              id={col.name}
              className="!h-2 !w-2 !border-white/20 !bg-blue-400"
              style={{ top: "auto" }}
            />

            {col.is_primary_key && (
              <Key className="h-3 w-3 shrink-0 text-yellow-400" />
            )}

            <span
              className={cn(
                "text-[11px]",
                col.is_primary_key ? "font-semibold" : "font-normal",
              )}
            >
              {col.name}
            </span>

            <span className="ml-auto text-[10px] text-muted-foreground">
              {col.data_type}
              {!col.is_nullable && (
                <span className="ml-1 text-red-400/60">*</span>
              )}
            </span>

            {/* Handle for outgoing edges */}
            <Handle
              type="source"
              position={Position.Right}
              id={col.name}
              className="!h-2 !w-2 !border-white/20 !bg-blue-400"
              style={{ top: "auto" }}
            />
          </div>
        ))}
      </div>

      {/* Footer with column count */}
      <div className="rounded-b-lg border-t border-white/5 px-3 py-0.5">
        <span className="text-[10px] text-muted-foreground">
          {data.columns.length} columns
        </span>
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);

import {
  Play,
  TextCursorInput,
  Square,
  Save,
  Clock,
  Bookmark,
  Database,
  Download,
  FileSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface QueryToolbarProps {
  onRun: () => void;
  onRunSelection: () => void;
  onStop?: () => void;
  onSave?: () => void;
  onToggleHistory?: () => void;
  onToggleSaved?: () => void;
  onExportCsv?: () => void;
  onExportJson?: () => void;
  onExportSqlInsert?: () => void;
  onExplain?: () => void;
  executing?: boolean;
  databases?: string[];
  activeDatabase?: string;
  onDatabaseChange?: (db: string) => void;
  hasResult?: boolean;
}

export function QueryToolbar({
  onRun,
  onRunSelection,
  onStop,
  onSave,
  onToggleHistory,
  onToggleSaved,
  onExportCsv,
  onExportJson,
  onExportSqlInsert,
  onExplain,
  executing,
  databases,
  activeDatabase,
  onDatabaseChange,
  hasResult,
}: QueryToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
      {/* Run */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs text-green-400 hover:text-green-300"
        onClick={onRun}
        disabled={executing}
      >
        <Play className="h-3.5 w-3.5" />
        Run
      </Button>

      {/* Run Selection */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={onRunSelection}
        disabled={executing}
        title="Run selection (Cmd+Shift+Enter)"
      >
        <TextCursorInput className="h-3.5 w-3.5" />
        Run Selection
      </Button>

      {/* Stop */}
      {executing && onStop && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-red-400 hover:text-red-300"
          onClick={onStop}
        >
          <Square className="h-3 w-3" />
          Stop
        </Button>
      )}

      {/* Explain */}
      {onExplain && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-amber-400 hover:text-amber-300"
          onClick={onExplain}
          disabled={executing}
          title="Explain query (Cmd+E)"
        >
          <FileSearch className="h-3.5 w-3.5" />
          Explain
        </Button>
      )}

      <div className="mx-1 h-4 w-px bg-white/10" />

      {/* Save Query */}
      {onSave && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onSave}
          title="Save query (Cmd+S)"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      )}

      {/* History */}
      {onToggleHistory && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onToggleHistory}
          title="Query History"
        >
          <Clock className="h-3.5 w-3.5" />
          History
        </Button>
      )}

      {/* Saved Queries */}
      {onToggleSaved && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onToggleSaved}
          title="Saved Queries"
        >
          <Bookmark className="h-3.5 w-3.5" />
          Saved
        </Button>
      )}

      <div className="flex-1" />

      {/* Export dropdown */}
      {hasResult && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExportCsv}>Export as CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={onExportJson}>Export as JSON</DropdownMenuItem>
            <DropdownMenuItem onClick={onExportSqlInsert}>Export as SQL INSERT</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Database selector */}
      {databases && databases.length > 0 && (
        <Select value={activeDatabase ?? ""} onValueChange={(v) => onDatabaseChange?.(v)}>
          <SelectTrigger
            className={cn("h-7 w-[140px] text-xs border-white/10")}
          >
            <Database className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((d) => (
              <SelectItem key={d} value={d} className="text-xs">
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

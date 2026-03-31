import { LayoutGrid, Maximize, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface ErToolbarProps {
  onAutoLayout: () => void;
  onFitView: () => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  tableCount?: number;
}

export function ErToolbar({
  onAutoLayout,
  onFitView,
  onExportPng,
  onExportSvg,
  tableCount,
}: ErToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={onAutoLayout}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Auto Layout
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={onFitView}
      >
        <Maximize className="h-3.5 w-3.5" />
        Fit
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {onExportPng && (
            <DropdownMenuItem onClick={onExportPng}>Export as PNG</DropdownMenuItem>
          )}
          {onExportSvg && (
            <DropdownMenuItem onClick={onExportSvg}>Export as SVG</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {tableCount !== undefined && (
        <span className="text-xs text-muted-foreground">
          {tableCount} table{tableCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

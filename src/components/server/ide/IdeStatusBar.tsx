import { Circle } from "lucide-react";

interface IdeStatusBarProps {
  language: string;
  line: number;
  col: number;
  filePath: string | null;
  isDirty: boolean;
}

export function IdeStatusBar({ language, line, col, filePath, isDirty }: IdeStatusBarProps) {
  return (
    <div className="h-6 bg-[#007ACC] text-white text-[11px] flex items-center justify-between px-2 shrink-0">
      <div className="flex items-center gap-2">
        {filePath && (
          <span className="flex items-center gap-1">
            {isDirty && <Circle className="size-2 fill-white" />}
            {filePath}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>Ln {line}, Col {col}</span>
        <span>{language}</span>
      </div>
    </div>
  );
}

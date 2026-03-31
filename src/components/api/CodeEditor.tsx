import { useRef } from "react";
import Editor from "@monaco-editor/react";
import { useSettingsStore } from "@/stores/settingsStore";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: "json" | "xml" | "text";
  readOnly?: boolean;
  className?: string;
  /** Explicit height passed to Monaco. Use "100%" + h-full on className for fill mode. */
  height?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = "json",
  readOnly = false,
  className = "",
  height = "200px",
}: CodeEditorProps) {
  const { getSetting } = useSettingsStore();
  const isDark = getSetting("app_theme", "dark") === "dark";
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const monacoLanguage =
    language === "json" ? "json" : language === "xml" ? "xml" : "plaintext";

  return (
    <div className={`overflow-hidden border border-white/10 ${className}`}>
      <Editor
        value={value}
        language={monacoLanguage}
        theme={isDark ? "vs-dark" : "light"}
        height={height}
        onChange={(v) => onChangeRef.current?.(v ?? "")}
        loading={null}
        options={{
          readOnly,
          fontSize: 13,
          fontFamily: '"JetBrains Mono", "Fira Code", "Menlo", "Courier New", monospace',
          minimap: { enabled: false },
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: "on",
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        }}
      />
    </div>
  );
}

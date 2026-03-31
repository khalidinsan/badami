import { useState, useRef, useCallback, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import {
  Save,
  X,
  WrapText,
  ZoomIn,
  ZoomOut,
  Loader2,
  FileWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { detectLanguage } from "@/lib/editorLanguage";
import { useSettingsStore } from "@/stores/settingsStore";

interface RemoteCodeEditorProps {
  remotePath: string;
  initialContent: string;
  readOnly?: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export function RemoteCodeEditor({
  remotePath,
  initialContent,
  readOnly = false,
  onSave,
  onClose,
}: RemoteCodeEditorProps) {
  const { getSetting } = useSettingsStore();
  const isDarkTheme = getSetting("app_theme", "dark") === "dark";

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState<"on" | "off">("on");
  const [fontSize, setFontSize] = useState(13);

  const filename = remotePath.split("/").pop() ?? "file";
  const language = detectLanguage(filename);

  // Use ref to avoid stale closure in Monaco's Ctrl+S command binding
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const savingRef = useRef(false);

  const handleSave = useCallback(async () => {
    if (savingRef.current || readOnly) return;
    const model = editorRef.current?.getModel();
    if (!model) return;
    const currentContent = model.getValue();
    savingRef.current = true;
    setSaving(true);
    try {
      await onSaveRef.current(currentContent);
      setHasChanges(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [readOnly]);

  // Keep ref always fresh so the mount-time keybinding works
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleEditorMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      // Add Ctrl+S save shortcut — uses ref to avoid stale closure
      editor.addCommand(
        // eslint-disable-next-line no-bitwise
        2048 | 49, // KeyMod.CtrlCmd | KeyCode.KeyS
        () => {
          handleSaveRef.current();
        },
      );
    },
    [],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      const newValue = value ?? "";
      setHasChanges(newValue !== initialContent);
    },
    [initialContent],
  );

  // Warn about unsaved changes before closing
  const handleClose = useCallback(() => {
    if (hasChanges) {
      const ok = window.confirm(
        "You have unsaved changes. Are you sure you want to close?",
      );
      if (!ok) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  // Update word wrap in editor
  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap });
  }, [wordWrap]);

  // Update font size in editor
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-card/50 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "truncate text-[13px] font-mono",
              hasChanges ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {filename}
            {hasChanges && <span className="ml-1 text-yellow-500">●</span>}
          </span>
          {readOnly && (
            <span className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <FileWarning className="h-3 w-3" />
              Read-only
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50 uppercase">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            title="Decrease font size"
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="w-6 text-center text-[10px] text-muted-foreground">
            {fontSize}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setFontSize((s) => Math.min(24, s + 1))}
            title="Increase font size"
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", wordWrap === "on" && "text-primary")}
            onClick={() => setWordWrap((w) => (w === "on" ? "off" : "on"))}
            title="Toggle word wrap"
          >
            <WrapText className="h-3 w-3" />
          </Button>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Breadcrumb: full path */}
      <div className="border-b border-border/20 bg-card/30 px-3 py-0.5">
        <span className="text-[11px] text-muted-foreground/60 font-mono truncate block">
          {remotePath}
        </span>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          defaultValue={initialContent}
          language={language}
          theme={isDarkTheme ? "vs-dark" : "light"}
          onChange={handleChange}
          onMount={handleEditorMount}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          options={{
            readOnly,
            fontSize,
            fontFamily: '"JetBrains Mono", "Fira Code", "Menlo", "Courier New", monospace',
            minimap: { enabled: false },
            wordWrap,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            lineNumbers: "on",
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}

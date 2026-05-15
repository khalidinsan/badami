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
  Minimize2,
  Maximize2,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { detectLanguage } from "@/lib/editorLanguage";
import { useSettingsStore } from "@/stores/settingsStore";

export interface EditorTab {
  id: string;
  path: string;
  content: string;
  originalContent: string;
  readOnly: boolean;
  hasChanges: boolean;
}

interface FileEditorModalProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onSave: (tabId: string, content: string) => Promise<void>;
  onClose: () => void;
  onContentChange: (tabId: string, content: string) => void;
}

type ModalState = "normal" | "minimized" | "fullscreen";

export function FileEditorModal({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onSave,
  onClose,
  onContentChange,
}: FileEditorModalProps) {
  const { getSetting } = useSettingsStore();
  const isDarkTheme = getSetting("app_theme", "dark") === "dark";

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState<"on" | "off">("off");
  const [fontSize, setFontSize] = useState(13);
  const [modalState, setModalState] = useState<ModalState>("normal");

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filename = activeTab?.path.split("/").pop() ?? "file";
  const language = activeTab ? detectLanguage(filename) : "plaintext";

  const handleSave = useCallback(async () => {
    if (!activeTab || activeTab.readOnly || saving) return;
    const model = editorRef.current?.getModel();
    if (!model) return;
    const currentContent = model.getValue();
    setSaving(true);
    try {
      await onSave(activeTab.id, currentContent);
    } finally {
      setSaving(false);
    }
  }, [activeTab, saving, onSave]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.addCommand(
      // Ctrl/Cmd + S
      2048 | 49,
      () => handleSaveRef.current(),
    );
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab) return;
      onContentChange(activeTab.id, value ?? "");
    },
    [activeTab, onContentChange],
  );

  // Update editor content when switching tabs
  useEffect(() => {
    if (activeTab && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== activeTab.content) {
        model.setValue(activeTab.content);
      }
    }
  }, [activeTabId]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap });
  }, [wordWrap]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  // Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    const unsaved = tabs.filter((t) => t.hasChanges);
    if (unsaved.length > 0) {
      const ok = window.confirm(
        `You have unsaved changes in ${unsaved.length} file(s). Close anyway?`,
      );
      if (!ok) return;
    }
    onClose();
  }, [tabs, onClose]);

  const handleTabClose = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.hasChanges) {
        const ok = window.confirm(
          `"${tab.path.split("/").pop()}" has unsaved changes. Close anyway?`,
        );
        if (!ok) return;
      }
      onTabClose(tabId);
    },
    [tabs, onTabClose],
  );

  if (modalState === "minimized") {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
        <span className="text-xs font-medium text-muted-foreground">
          Editor ({tabs.length} file{tabs.length > 1 ? "s" : ""})
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setModalState("normal")}
          title="Restore"
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl",
        modalState === "fullscreen"
          ? "inset-0 rounded-none"
          : "bottom-6 left-16 right-6 top-12",
      )}
    >
      {/* Title bar */}
      <div className="flex h-9 items-center justify-between border-b border-border/40 bg-card/80 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-muted-foreground">Editor</span>
          {activeTab?.readOnly && (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setModalState("minimized")}
            title="Minimize"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setModalState(modalState === "fullscreen" ? "normal" : "fullscreen")}
            title={modalState === "fullscreen" ? "Restore" : "Fullscreen"}
          >
            {modalState === "fullscreen" ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
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

      {/* Tab bar */}
      <div className="flex h-8 items-center gap-0 overflow-x-auto border-b border-border/40 bg-card/50 px-1">
        {tabs.map((tab) => {
          const tabName = tab.path.split("/").pop() ?? "file";
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group relative flex h-8 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/20 px-3 text-xs transition-colors",
                isActive
                  ? "bg-background text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#007AFF]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground/70",
              )}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="max-w-[140px] truncate">
                {tabName}
                {tab.hasChanges && <span className="ml-1 text-yellow-500">●</span>}
              </span>
              <button
                className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-60"
                onClick={(e) => handleTabClose(tab.id, e)}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      {activeTab && (
        <div className="flex items-center justify-between border-b border-border/20 bg-card/30 px-3 py-1">
          <span className="text-[11px] text-muted-foreground/60 font-mono truncate">
            {activeTab.path}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50 uppercase mr-2">
              {language}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            >
              <ZoomOut className="h-3 w-3" />
            </Button>
            <span className="w-5 text-center text-[10px] text-muted-foreground">{fontSize}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setFontSize((s) => Math.min(24, s + 1))}
            >
              <ZoomIn className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-5 w-5", wordWrap === "on" && "text-primary")}
              onClick={() => setWordWrap((w) => (w === "on" ? "off" : "on"))}
              title="Toggle word wrap"
            >
              <WrapText className="h-3 w-3" />
            </Button>
            {!activeTab.readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleSave}
                disabled={saving || !activeTab.hasChanges}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeTab ? (
          <Editor
            key={activeTab.id}
            defaultValue={activeTab.content}
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
              readOnly: activeTab.readOnly,
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
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">No file open</p>
          </div>
        )}
      </div>
    </div>
  );
}

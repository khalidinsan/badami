import { useRef, useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { X } from 'lucide-react';
import { useIdeStore } from '@/stores/ideStore';
import { cn } from '@/lib/utils';

interface IdeEditorProps {
  onSave: (path: string, content: string) => void;
  onCursorChange?: (line: number, col: number) => void;
}

export function IdeEditor({ onSave, onCursorChange }: IdeEditorProps) {
  const { tabs, activeFile, setActiveFile, closeTab, closeOtherTabs, closeAllTabs, updateContent, promoteTab } = useIdeStore();
  const editorRef = useRef<any>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [contextMenu]);

  const activeTab = tabs.find((t) => t.path === activeFile);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile) {
        onSave(activeFile, editor.getValue());
      }
    });

    editor.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column);
    });
  };

  if (!tabs.length) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1e1e1e] text-zinc-500 text-sm">
        No files open
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex shrink-0 overflow-x-auto bg-[#252526] border-b border-[#1e1e1e]">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            onClick={() => setActiveFile(tab.path)}
            onDoubleClick={() => promoteTab(tab.path)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, path: tab.path }); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs shrink-0 border-r border-[#1e1e1e]',
              tab.path === activeFile
                ? 'bg-[#1e1e1e] text-white'
                : 'text-zinc-400 hover:bg-[#2d2d2d]',
              tab.isPreview && 'italic'
            )}
          >
            {tab.isDirty && <span className="w-2 h-2 rounded-full bg-white" />}
            <span>{tab.name}</span>
            <X
              className="w-3.5 h-3.5 ml-1 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                if (tab.isDirty && !confirm('Discard unsaved changes to ' + tab.name + '?')) return;
                closeTab(tab.path);
              }}
            />
          </button>
        ))}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[300] bg-[#252526] border border-[#454545] rounded shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { closeTab(contextMenu.path); setContextMenu(null); }}>Close</button>
          <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { closeOtherTabs(contextMenu.path); setContextMenu(null); }}>Close Others</button>
          <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { closeAllTabs(); setContextMenu(null); }}>Close All</button>
          <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { navigator.clipboard.writeText(contextMenu.path); setContextMenu(null); }}>Copy Path</button>
        </div>
      )}

      {activeTab && (
        <div className="shrink-0 h-6 bg-[#1e1e1e] px-3 flex items-center gap-1 text-[11px] text-[#888]">
          {activeTab.path.split('/').map((segment, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <span className={i === arr.length - 1 ? 'text-[#ccc]' : ''}>{segment}</span>
            </span>
          ))}
        </div>
      )}

      {activeTab && (
        <Editor
          height="100%"
          path={activeTab.path}
          defaultValue={activeTab.content}
          theme="vs-dark"
          saveViewState={true}
          onChange={(value) => updateContent(activeFile!, value ?? '')}
          onMount={handleMount}
          options={{
            fontSize: 13,
            minimap: { enabled: true },
            automaticLayout: true,
            wordWrap: 'on',
            tabSize: 2,
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </div>
  );
}

import { useRef, useEffect, useCallback, useMemo } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintGutter } from "@codemirror/lint";
import { getSqlDialect } from "@/lib/sqlDialect";
import type { DbEngine } from "@/stores/dbStore";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  engine?: DbEngine;
  /** Table names for autocomplete */
  tableNames?: string[];
  /** Column names map for context-aware autocomplete */
  columnMap?: Record<string, string[]>;
  onRun?: () => void;
  onRunSelection?: () => void;
  className?: string;
}

export function QueryEditor({
  value,
  onChange,
  engine,
  tableNames,
  columnMap,
  onRun,
  onRunSelection,
  className = "",
}: QueryEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onRunSelectionRef = useRef(onRunSelection);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onRunSelectionRef.current = onRunSelection;

  // Compartments for dynamic reconfiguration
  const sqlLangCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());

  // Build SQL config for CodeMirror
  const sqlConfig = useMemo<SQLConfig>(() => {
    const dialect = getSqlDialect(engine);
    const schema: Record<string, string[]> = {};
    if (tableNames) {
      for (const t of tableNames) {
        schema[t] = columnMap?.[t] ?? [];
      }
    }
    return { dialect, schema, upperCaseKeywords: true };
  }, [engine, tableNames, columnMap]);

  // Custom keymap for run/run-selection
  const runKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRunRef.current?.();
            return true;
          },
        },
        {
          key: "Mod-Shift-Enter",
          run: () => {
            onRunSelectionRef.current?.();
            return true;
          },
        },
      ]),
    [],
  );

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        lintGutter(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        themeCompartment.current.of(oneDark),
        sqlLangCompartment.current.of(sql(sqlConfig)),
        runKeymap,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "13px",
            fontFamily: '"JetBrains Mono", "Fira Code", "Menlo", "Courier New", monospace',
          },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { padding: "8px 0" },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync SQL dialect when engine / schema changes
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: sqlLangCompartment.current.reconfigure(sql(sqlConfig)),
    });
  }, [sqlConfig]);

  // Sync external value changes (e.g., loading saved query)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  /** Get the currently selected text, or the full document if nothing is selected */
  const getSelectedText = useCallback(() => {
    const view = viewRef.current;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    if (from !== to) {
      return view.state.sliceDoc(from, to);
    }
    return view.state.doc.toString();
  }, []);

  // Expose helper via ref-like pattern for parent
  useEffect(() => {
    (containerRef.current as unknown as { getSelectedText?: () => string })!.getSelectedText =
      getSelectedText;
  }, [getSelectedText]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden border border-white/10 rounded-lg ${className}`}
      data-query-editor
    />
  );
}

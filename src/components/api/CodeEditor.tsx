import { useRef, useEffect, useCallback } from "react";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
} from "@codemirror/autocomplete";
import { lineNumbers, highlightActiveLine } from "@codemirror/view";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: "json" | "xml" | "text";
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = "json",
  readOnly = false,
  placeholder = "",
  className = "",
  minHeight = "120px",
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const getLanguageExtension = useCallback(() => {
    switch (language) {
      case "json":
        return json();
      case "xml":
        return xml();
      default:
        return [];
    }
  }, [language]);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      autocompletion(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      getLanguageExtension(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        ...foldKeymap,
      ]),
      EditorView.theme({
        "&": { minHeight, fontSize: "13px", fontFamily: "monospace" },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { padding: "8px 0" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
        },
      }),
    ];

    if (placeholder) {
      extensions.push(placeholderExt(placeholder));
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
      extensions.push(EditorView.editable.of(false));
    } else {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
      );
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate editor when language or readOnly changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  // Update content when value changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentVal = view.state.doc.toString();
    if (currentVal !== value) {
      view.dispatch({
        changes: { from: 0, to: currentVal.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg border border-white/10 bg-[#1e1e1e] ${className}`}
    />
  );
}

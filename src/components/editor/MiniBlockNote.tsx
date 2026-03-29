import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { defaultBlockSpecs, BlockNoteSchema, filterSuggestionItems } from "@blocknote/core";
import type { Block } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCallback, useRef, useEffect } from "react";

// Minimal schema — no custom blocks for the compact editor
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
  },
});

function parseContent(content: string | null | undefined): Block[] | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Block[];
  } catch {
    // Plain text fallback — convert to paragraph blocks
    return content.split("\n").filter(Boolean).map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })) as unknown as Block[];
  }
  return undefined;
}

interface MiniBlockNoteProps {
  initialContent?: string | null;
  onChange?: (content: string) => void;
}

export function MiniBlockNote({ initialContent, onChange }: MiniBlockNoteProps) {
  const parsed = parseContent(initialContent);

  const editor = useCreateBlockNote({
    schema,
    initialContent: parsed as any,
  });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track external content updates (e.g. from another window via task-changed)
  const lastExternalContentRef = useRef(initialContent);
  useEffect(() => {
    if (initialContent === lastExternalContentRef.current) return;
    lastExternalContentRef.current = initialContent;
    // Only apply if the editor's current JSON differs from the incoming content
    const currentJson = JSON.stringify(editor.document);
    if (currentJson === initialContent) return;
    const newBlocks = parseContent(initialContent);
    if (!newBlocks) return;
    editor.replaceBlocks(editor.document, newBlocks as any);
  }, [initialContent, editor]);

  const handleChange = useCallback(() => {
    if (onChangeRef.current) {
      const content = JSON.stringify(editor.document);
      onChangeRef.current(content);
    }
  }, [editor]);

  return (
    <div className="sticky-mini-editor">
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        theme="light"
        sideMenu={false}
        formattingToolbar={false}
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(getDefaultReactSlashMenuItems(editor), query)
          }
        />
      </BlockNoteView>
    </div>
  );
}

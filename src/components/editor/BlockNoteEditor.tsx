import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
} from "@blocknote/core";
import type { Block } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getFileName } from "@/lib/fileSystem";
import { FileMention } from "./FileMention";
import { VideoEmbed } from "./VideoEmbed";

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    videoEmbed: VideoEmbed(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileMention: FileMention,
  },
});

const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif", "tiff", "ico",
]);

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

async function filePathToDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return `data:${mime};base64,${b64}`;
}

async function uploadFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function handleImagePaste(
  event: ClipboardEvent,
  editor: typeof schema.BlockNoteEditor,
  defaultPasteHandler: () => boolean,
): boolean {
  const items = event.clipboardData?.items;
  if (!items) return defaultPasteHandler();

  const imageItems = Array.from(items).filter((item) =>
    item.type.startsWith("image/"),
  );
  if (imageItems.length === 0) return defaultPasteHandler();

  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) continue;
    uploadFile(file).then((url) => {
      editor.insertBlocks(
        [{ type: "image", props: { url, name: file.name } } as any],
        editor.getTextCursorPosition().block,
        "after",
      );
    });
  }

  return true;
}

interface BlockNoteEditorProps {
  initialContent?: string | null;
  onChange?: (content: string) => void;
  editable?: boolean;
}

export function BlockNoteEditor({
  initialContent,
  onChange,
  editable = true,
}: BlockNoteEditorProps) {
  const parsedContent = initialContent
    ? (JSON.parse(initialContent) as Block[])
    : undefined;

  const editor = useCreateBlockNote({
    schema,
    initialContent: parsedContent as any,
    uploadFile,
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }) =>
      handleImagePaste(event, ed, () => defaultPasteHandler() ?? false),
  });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [isDragOver, setIsDragOver] = useState(false);

  // Handle file drops from Finder/OS via Tauri's native drag-drop interceptor
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "over") {
          setIsDragOver(true);
        } else if (payload.type === "drop") {
          setIsDragOver(false);
          const imagePaths = (payload.paths ?? []).filter(isImagePath);
          for (const path of imagePaths) {
            filePathToDataUrl(path).then((url) => {
              const name = path.split("/").pop() ?? "image";
              editor.insertBlocks(
                [{ type: "image", props: { url, name } } as any],
                editor.getTextCursorPosition().block,
                "after",
              );
            });
          }
        } else {
          setIsDragOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => unlisten?.();
  }, [editor]);

  const handleChange = useCallback(() => {
    if (onChangeRef.current) {
      const content = JSON.stringify(editor.document);
      onChangeRef.current(content);
    }
  }, [editor]);

  const getSlashMenuItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [
          ...getDefaultReactSlashMenuItems(editor),
          {
            title: "Video Embed",
            subtext: "Embed YouTube, Vimeo, atau Dailymotion",
            group: "Media",
            aliases: ["video", "embed", "youtube", "vimeo", "dailymotion"],
            onItemClick: () => {
              editor.insertBlocks(
                [{ type: "videoEmbed" } as any],
                editor.getTextCursorPosition().block,
                "after",
              );
            },
          },
          {
            title: "File",
            subtext: "Mention a file from your system",
            group: "Mentions",
            aliases: ["file", "attachment"],
            onItemClick: async () => {
              const selected = await openDialog({
                multiple: false,
                directory: false,
              });
              if (selected) {
                const path = selected as unknown as string;
                const name = await getFileName(path);
                editor.insertInlineContent([
                  {
                    type: "fileMention",
                    props: { name, path, kind: "file" },
                  } as any,
                  " ",
                ]);
              }
            },
          },
          {
            title: "Folder",
            subtext: "Mention a folder from your system",
            group: "Mentions",
            aliases: ["folder", "directory"],
            onItemClick: async () => {
              const selected = await openDialog({
                multiple: false,
                directory: true,
              });
              if (selected) {
                const path = selected as unknown as string;
                const name = await getFileName(path);
                editor.insertInlineContent([
                  {
                    type: "fileMention",
                    props: { name, path, kind: "folder" },
                  } as any,
                  " ",
                ]);
              }
            },
          },
        ],
        query,
      ),
    [editor],
  );

  return (
    <div className="relative h-full w-full">
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
          <p className="text-sm font-medium text-primary">Drop image here</p>
        </div>
      )}
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme="light"
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashMenuItems}
        />
      </BlockNoteView>
    </div>
  );
}

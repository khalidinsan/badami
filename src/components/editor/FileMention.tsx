import { createReactInlineContentSpec } from "@blocknote/react";
import { File, Folder } from "lucide-react";
import { openInOS } from "@/lib/osOpen";

export const FileMention = createReactInlineContentSpec(
  {
    type: "fileMention" as const,
    propSchema: {
      name: { default: "" },
      path: { default: "" },
      kind: { default: "file" as const, values: ["file", "folder"] as const },
    },
    content: "none",
  } as const,
  {
    render: (props) => {
      const { name, path, kind } = props.inlineContent.props;
      const Icon = kind === "folder" ? Folder : File;

      return (
        <span
          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
          onClick={() => {
            if (path) openInOS(path);
          }}
          title={path}
        >
          <Icon className="h-3 w-3 shrink-0" />
          {name || path}
        </span>
      );
    },
  },
);

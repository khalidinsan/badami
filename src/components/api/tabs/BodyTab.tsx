import { CodeEditor } from "../CodeEditor";
import { KeyValueTable } from "../KeyValueTable";
import type { BodyType, KeyValueEntry } from "@/types/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BodyTabProps {
  bodyType: BodyType;
  bodyContent: string;
  onTypeChange: (type: BodyType) => void;
  onContentChange: (content: string) => void;
}

export function BodyTab({
  bodyType,
  bodyContent,
  onTypeChange,
  onContentChange,
}: BodyTabProps) {
  // For form-data and urlencoded, parse content as KeyValueEntry[]
  const getKVItems = (): KeyValueEntry[] => {
    if (!bodyContent) return [{ key: "", value: "", enabled: true }];
    try {
      return JSON.parse(bodyContent);
    } catch {
      return [{ key: "", value: "", enabled: true }];
    }
  };

  const setKVItems = (items: KeyValueEntry[]) => {
    onContentChange(JSON.stringify(items));
  };

  return (
    <div className="p-3">
      <div className="mb-3">
        <Select
          value={bodyType}
          onValueChange={(v) => onTypeChange(v as BodyType)}
        >
          <SelectTrigger className="h-7 w-40 border-white/10 bg-white/5 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="form_data">Form Data</SelectItem>
            <SelectItem value="urlencoded">URL Encoded</SelectItem>
            <SelectItem value="raw">Raw</SelectItem>
            <SelectItem value="binary">Binary</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {bodyType === "none" && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          This request does not have a body
        </p>
      )}

      {bodyType === "json" && (
        <CodeEditor
          value={bodyContent}
          onChange={onContentChange}
          language="json"
          placeholder='{\n  "key": "value"\n}'
          minHeight="160px"
        />
      )}

      {bodyType === "raw" && (
        <CodeEditor
          value={bodyContent}
          onChange={onContentChange}
          language="text"
          placeholder="Enter raw body..."
          minHeight="160px"
        />
      )}

      {(bodyType === "form_data" || bodyType === "urlencoded") && (
        <KeyValueTable
          items={getKVItems()}
          onChange={setKVItems}
          keyPlaceholder="Field"
          valuePlaceholder="Value"
        />
      )}

      {bodyType === "binary" && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Binary file upload coming soon
        </p>
      )}
    </div>
  );
}

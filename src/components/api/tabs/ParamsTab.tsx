import { KeyValueTable } from "../KeyValueTable";
import type { KeyValueEntry } from "@/types/api";

interface ParamsTabProps {
  params: KeyValueEntry[];
  onChange: (params: KeyValueEntry[]) => void;
}

export function ParamsTab({ params, onChange }: ParamsTabProps) {
  return (
    <div className="p-3">
      <KeyValueTable
        items={params}
        onChange={onChange}
        keyPlaceholder="Parameter"
        valuePlaceholder="Value"
      />
    </div>
  );
}

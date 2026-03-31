import { useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  X,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateCreateTable,
  type ColumnDef,
  type IndexDef,
  type ForeignKeyDef,
} from "@/lib/ddlGenerator";
import type { DbEngine } from "@/stores/dbStore";
import { useSchemaManager } from "@/hooks/useSchemaManager";
import { toast } from "sonner";

interface CreateTableWizardProps {
  poolId: string;
  engine: DbEngine;
  onClose: () => void;
  onCreated: () => void;
}

type Step = "name" | "columns" | "constraints" | "preview";

export function CreateTableWizard({
  poolId,
  engine,
  onClose,
  onCreated,
}: CreateTableWizardProps) {
  const { executeDdl, loading } = useSchemaManager();
  const [step, setStep] = useState<Step>("name");
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([
    {
      name: "id",
      dataType: engine === "postgresql" ? "SERIAL" : "INT",
      nullable: false,
      isPrimaryKey: true,
      defaultValue: null,
      extra: engine === "mysql" || engine === "mariadb" ? "AUTO_INCREMENT" : null,
    },
  ]);
  const [indexes, setIndexes] = useState<IndexDef[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyDef[]>([]);

  const steps: Step[] = ["name", "columns", "constraints", "preview"];
  const stepIdx = steps.indexOf(step);

  const canProceed = () => {
    if (step === "name") return tableName.trim().length > 0;
    if (step === "columns") return columns.some((c) => c.name.trim());
    return true;
  };

  const next = () => {
    const i = stepIdx + 1;
    if (i < steps.length) setStep(steps[i]);
  };
  const prev = () => {
    const i = stepIdx - 1;
    if (i >= 0) setStep(steps[i]);
  };

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      {
        name: "",
        dataType: "VARCHAR(255)",
        nullable: true,
        isPrimaryKey: false,
        defaultValue: null,
        extra: null,
      },
    ]);
  };

  const updateColumn = (idx: number, field: keyof ColumnDef, value: unknown) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const removeColumn = (idx: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const addIndex = () => {
    setIndexes((prev) => [
      ...prev,
      { name: `idx_${tableName}_`, type: "INDEX", columns: [] },
    ]);
  };

  const updateIndex = (idx: number, field: keyof IndexDef, value: unknown) => {
    setIndexes((prev) => prev.map((ix, i) => (i === idx ? { ...ix, [field]: value } : ix)));
  };

  const removeIndex = (idx: number) => {
    setIndexes((prev) => prev.filter((_, i) => i !== idx));
  };

  const addFk = () => {
    setForeignKeys((prev) => [
      ...prev,
      {
        name: `fk_${tableName}_`,
        column: "",
        refTable: "",
        refColumn: "",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    ]);
  };

  const updateFk = (idx: number, field: keyof ForeignKeyDef, value: unknown) => {
    setForeignKeys((prev) =>
      prev.map((fk, i) => (i === idx ? { ...fk, [field]: value } : fk)),
    );
  };

  const removeFk = (idx: number) => {
    setForeignKeys((prev) => prev.filter((_, i) => i !== idx));
  };

  const generatedSql = generateCreateTable(
    tableName,
    columns.filter((c) => c.name.trim()),
    indexes.filter((i) => i.columns.length > 0),
    foreignKeys.filter((f) => f.column && f.refTable && f.refColumn),
    engine,
  );

  const handleExecute = async () => {
    try {
      await executeDdl(poolId, generatedSql);
      toast.success(`Table ${tableName} created`);
      onCreated();
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-medium">
            Create Table — Step {stepIdx + 1} of {steps.length}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {step === "name" && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Table Name
              </label>
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="my_table"
                className="text-sm"
                autoFocus
              />
            </div>
          )}

          {step === "columns" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Columns</div>
              <div className="space-y-1.5">
                {columns.map((col, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg bg-white/5 p-1.5">
                    <Input
                      value={col.name}
                      onChange={(e) => updateColumn(i, "name", e.target.value)}
                      placeholder="name"
                      className="h-7 flex-1 text-xs"
                    />
                    <Input
                      value={col.dataType}
                      onChange={(e) => updateColumn(i, "dataType", e.target.value)}
                      placeholder="type"
                      className="h-7 w-32 text-xs"
                    />
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox
                        checked={col.isPrimaryKey}
                        onCheckedChange={(v) => updateColumn(i, "isPrimaryKey", v)}
                      />
                      PK
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox
                        checked={col.nullable}
                        onCheckedChange={(v) => updateColumn(i, "nullable", v)}
                      />
                      Null
                    </label>
                    <Input
                      value={col.defaultValue ?? ""}
                      onChange={(e) => updateColumn(i, "defaultValue", e.target.value || null)}
                      placeholder="default"
                      className="h-7 w-24 text-xs"
                    />
                    <button
                      onClick={() => removeColumn(i)}
                      className="rounded p-1 hover:bg-white/10"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={addColumn}
              >
                <Plus className="h-3 w-3" />
                Add Column
              </Button>
            </div>
          )}

          {step === "constraints" && (
            <div className="space-y-4">
              {/* Indexes */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Indexes</div>
                {indexes.map((idx, i) => (
                  <div key={i} className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-white/5 p-1.5">
                    <Input
                      value={idx.name}
                      onChange={(e) => updateIndex(i, "name", e.target.value)}
                      placeholder="index_name"
                      className="h-7 flex-1 text-xs"
                    />
                    <Select
                      value={idx.type}
                      onValueChange={(v) => updateIndex(i, "type", v)}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INDEX">INDEX</SelectItem>
                        <SelectItem value="UNIQUE">UNIQUE</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={idx.columns.join(", ")}
                      onChange={(e) =>
                        updateIndex(
                          i,
                          "columns",
                          e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        )
                      }
                      placeholder="col1, col2"
                      className="h-7 flex-1 text-xs"
                    />
                    <button onClick={() => removeIndex(i)} className="rounded p-1 hover:bg-white/10">
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addIndex}>
                  <Plus className="h-3 w-3" />
                  Add Index
                </Button>
              </div>

              {/* Foreign keys */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Foreign Keys</div>
                {foreignKeys.map((fk, i) => (
                  <div key={i} className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-white/5 p-1.5">
                    <Input
                      value={fk.name}
                      onChange={(e) => updateFk(i, "name", e.target.value)}
                      placeholder="fk_name"
                      className="h-7 w-28 text-xs"
                    />
                    <Input
                      value={fk.column}
                      onChange={(e) => updateFk(i, "column", e.target.value)}
                      placeholder="column"
                      className="h-7 w-24 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">→</span>
                    <Input
                      value={fk.refTable}
                      onChange={(e) => updateFk(i, "refTable", e.target.value)}
                      placeholder="ref_table"
                      className="h-7 w-24 text-xs"
                    />
                    <Input
                      value={fk.refColumn}
                      onChange={(e) => updateFk(i, "refColumn", e.target.value)}
                      placeholder="ref_col"
                      className="h-7 w-24 text-xs"
                    />
                    <button onClick={() => removeFk(i)} className="rounded p-1 hover:bg-white/10">
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addFk}>
                  <Plus className="h-3 w-3" />
                  Add Foreign Key
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Generated SQL
              </div>
              <pre className="whitespace-pre-wrap rounded-lg bg-white/5 p-3 font-mono text-xs leading-relaxed text-foreground">
                {generatedSql}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs"
            onClick={prev}
            disabled={stepIdx === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </Button>

          {step === "preview" ? (
            <Button
              size="sm"
              className="gap-1 text-xs"
              onClick={handleExecute}
              disabled={loading}
            >
              <Play className="h-3.5 w-3.5" />
              Execute
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1 text-xs"
              onClick={next}
              disabled={!canProceed()}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

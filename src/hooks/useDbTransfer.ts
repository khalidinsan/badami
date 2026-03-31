import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ExportResult {
  rows_exported: number;
  file_path: string;
  duration_ms: number;
}

interface ImportResult {
  rows_imported: number;
  rows_failed: number;
  errors: string[];
  duration_ms: number;
}

interface CsvPreview {
  headers: string[];
  rows: string[][];
  total_rows: number;
}

export function useDbTransfer() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ExportResult | ImportResult | null>(null);

  const exportCsv = useCallback(
    async (poolId: string, sql: string, outputPath: string): Promise<ExportResult> => {
      setExporting(true);
      try {
        const result = await invoke<ExportResult>("dbc_export_csv", {
          poolId,
          sql,
          outputPath,
        });
        setLastResult(result);
        return result;
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  const exportJson = useCallback(
    async (poolId: string, sql: string, outputPath: string): Promise<ExportResult> => {
      setExporting(true);
      try {
        const result = await invoke<ExportResult>("dbc_export_json", {
          poolId,
          sql,
          outputPath,
        });
        setLastResult(result);
        return result;
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  const exportSql = useCallback(
    async (
      poolId: string,
      database: string | null,
      tables: string[],
      outputPath: string,
      withData: boolean,
      compress: boolean,
    ): Promise<ExportResult> => {
      setExporting(true);
      try {
        const result = await invoke<ExportResult>("dbc_export_sql", {
          poolId,
          database,
          tables,
          outputPath,
          withData,
          compress,
        });
        setLastResult(result);
        return result;
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  const importCsv = useCallback(
    async (
      poolId: string,
      table: string,
      filePath: string,
      columnMapping: Record<string, string>,
      skipHeader: boolean,
      delimiter?: string,
    ): Promise<ImportResult> => {
      setImporting(true);
      try {
        const result = await invoke<ImportResult>("dbc_import_csv", {
          poolId,
          table,
          filePath,
          columnMapping,
          skipHeader,
          delimiter,
        });
        setLastResult(result);
        return result;
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  const importSql = useCallback(
    async (poolId: string, filePath: string): Promise<ImportResult> => {
      setImporting(true);
      try {
        const result = await invoke<ImportResult>("dbc_import_sql", {
          poolId,
          filePath,
        });
        setLastResult(result);
        return result;
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  const previewCsv = useCallback(
    async (filePath: string, delimiter?: string, maxRows?: number): Promise<CsvPreview> => {
      return invoke<CsvPreview>("dbc_preview_csv", {
        filePath,
        delimiter,
        maxRows,
      });
    },
    [],
  );

  return {
    exporting,
    importing,
    lastResult,
    exportCsv,
    exportJson,
    exportSql,
    importCsv,
    importSql,
    previewCsv,
  };
}

export type { ExportResult, ImportResult, CsvPreview };

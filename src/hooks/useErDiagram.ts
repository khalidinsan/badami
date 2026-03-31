import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Node, Edge } from "reactflow";
import { autoLayout } from "@/lib/erLayoutEngine";
import { getErLayout, saveErLayout } from "@/db/queries/dbClient";

interface ErColumnInfo {
  name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
}

interface ErForeignKey {
  column: string;
  ref_table: string;
  ref_column: string;
}

interface ErTableInfo {
  name: string;
  columns: ErColumnInfo[];
  foreign_keys: ErForeignKey[];
}

export function useErDiagram() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = useCallback(
    async (poolId: string, connectionId: string, database?: string) => {
      setLoading(true);
      setError(null);
      try {
        const tables = await invoke<ErTableInfo[]>("dbc_get_er_schema", {
          poolId,
          database: database ?? null,
        });

        // Transform to React Flow nodes
        const newNodes: Node[] = tables.map((t) => ({
          id: t.name,
          type: "tableNode",
          data: {
            label: t.name,
            columns: t.columns,
          },
          position: { x: 0, y: 0 },
        }));

        // Transform FK relations to edges
        const newEdges: Edge[] = [];
        for (const t of tables) {
          for (const fk of t.foreign_keys) {
            newEdges.push({
              id: `${t.name}.${fk.column}->${fk.ref_table}.${fk.ref_column}`,
              source: t.name,
              target: fk.ref_table,
              sourceHandle: fk.column,
              targetHandle: fk.ref_column,
              type: "smoothstep",
              animated: true,
              label: `${fk.column} → ${fk.ref_column}`,
              style: { stroke: "#007AFF", strokeWidth: 1.5 },
              labelStyle: { fontSize: 10, fill: "#888" },
            });
          }
        }

        // Try loading saved layout
        const dbName = database ?? "default";
        const saved = await getErLayout(connectionId, dbName);
        if (saved?.layout_data) {
          try {
            const savedPositions = JSON.parse(saved.layout_data) as Record<
              string,
              { x: number; y: number }
            >;
            const positioned = newNodes.map((n) => {
              const pos = savedPositions[n.id];
              return pos ? { ...n, position: pos } : n;
            });
            // Auto-layout for nodes without saved positions
            const hasAll = positioned.every(
              (n) => n.position.x !== 0 || n.position.y !== 0,
            );
            if (hasAll) {
              setNodes(positioned);
            } else {
              setNodes(autoLayout(positioned, newEdges));
            }
          } catch {
            setNodes(autoLayout(newNodes, newEdges));
          }
        } else {
          setNodes(autoLayout(newNodes, newEdges));
        }

        setEdges(newEdges);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const persistLayout = useCallback(
    async (connectionId: string, database: string, currentNodes: Node[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of currentNodes) {
        positions[n.id] = n.position;
      }
      await saveErLayout(connectionId, database, JSON.stringify(positions));
    },
    [],
  );

  const applyAutoLayout = useCallback(() => {
    setNodes((prev) => autoLayout(prev, edges));
  }, [edges]);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    loading,
    error,
    fetchSchema,
    persistLayout,
    applyAutoLayout,
  };
}

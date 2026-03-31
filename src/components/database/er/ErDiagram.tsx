import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import { TableNode } from "./TableNode";
import { ErToolbar } from "./ErToolbar";
import { useErDiagram } from "@/hooks/useErDiagram";
import { Loader2 } from "lucide-react";

interface ErDiagramProps {
  poolId: string;
  connectionId: string;
  database?: string;
}

function ErDiagramInner({ poolId, connectionId, database }: ErDiagramProps) {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    loading,
    error,
    fetchSchema,
    persistLayout,
    applyAutoLayout,
  } = useErDiagram();

  const { fitView } = useReactFlow();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  useEffect(() => {
    fetchSchema(poolId, connectionId, database);
  }, [poolId, connectionId, database, fetchSchema]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));

      // Debounce save layout
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        setNodes((currentNodes) => {
          persistLayout(connectionId, database ?? "default", currentNodes).catch(
            console.error,
          );
          return currentNodes;
        });
      }, 1000);
    },
    [setNodes, persistLayout, connectionId, database],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges],
  );

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  const handleExportSvg = useCallback(() => {
    const svgEl = document.querySelector(".react-flow__viewport");
    if (!svgEl) return;
    // Wrap in SVG
    const wrapper = document.querySelector(".react-flow__renderer");
    if (!wrapper) return;
    const { width, height } = wrapper.getBoundingClientRect();

    const svgClone = svgEl.cloneNode(true) as SVGElement;
    const svgDoc = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgDoc.setAttribute("width", String(width));
    svgDoc.setAttribute("height", String(height));
    svgDoc.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgDoc.appendChild(svgClone);

    const blob = new Blob([svgDoc.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "er_diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading schema...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No tables found in this database
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ErToolbar
        onAutoLayout={applyAutoLayout}
        onFitView={handleFitView}
        onExportSvg={handleExportSvg}
        tableCount={nodes.length}
      />
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Controls className="!border-white/10 !bg-background/80 !shadow-lg [&>button]:!border-white/10 [&>button]:!bg-background [&>button]:!text-foreground [&>button]:hover:!bg-white/10" />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="rgba(255,255,255,0.05)"
          />
          <MiniMap
            className="!border-white/10 !bg-background/80"
            nodeColor="rgba(0, 122, 255, 0.3)"
            maskColor="rgba(0, 0, 0, 0.5)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function ErDiagram(props: ErDiagramProps) {
  return (
    <ReactFlowProvider>
      <ErDiagramInner {...props} />
    </ReactFlowProvider>
  );
}

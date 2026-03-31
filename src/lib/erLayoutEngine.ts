import dagre from "dagre";
import type { Node, Edge } from "reactflow";

const NODE_WIDTH = 220;
const NODE_BASE_HEIGHT = 40; // header
const ROW_HEIGHT = 22;

interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeSpacing?: number;
  rankSpacing?: number;
}

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  const { direction = "LR", nodeSpacing = 50, rankSpacing = 80 } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    const colCount = (node.data?.columns?.length ?? 0) as number;
    const height = NODE_BASE_HEIGHT + colCount * ROW_HEIGHT;
    g.setNode(node.id, { width: NODE_WIDTH, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const n = g.node(node.id);
    const colCount = (node.data?.columns?.length ?? 0) as number;
    const height = NODE_BASE_HEIGHT + colCount * ROW_HEIGHT;
    return {
      ...node,
      position: {
        x: n.x - NODE_WIDTH / 2,
        y: n.y - height / 2,
      },
    };
  });
}

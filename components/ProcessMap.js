"use client";

import { useMemo } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const LANE_Y = { AI: 40, DESIGN: 240, MEMO: 440 };
const COLOR = { AI: '#3554d1', DESIGN: '#1f9d6b', MEMO: '#b8860b' };

function labelFor(node) {
  if (node.type === 'AI') {
    return `AI\n${(node.ai_turns?.prompt || '').slice(0, 24)}`;
  }
  if (node.type === 'DESIGN') {
    return `設計案\n${node.designs?.caption?.slice(0, 24) || '(無題)'}`;
  }
  if (node.type === 'MEMO') {
    return `メモ\n${(node.memos?.text || '').slice(0, 24)}`;
  }
  return node.type;
}

export default function ProcessMap({ nodes, links, fragments, onNodeClick }) {
  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  const flowNodes = useMemo(
    () =>
      nodes.map((n, idx) => ({
        id: n.id,
        position: { x: idx * 220 + 40, y: LANE_Y[n.type] ?? 40 },
        data: { label: labelFor(n) },
        style: {
          border: `2px solid ${COLOR[n.type] || '#999'}`,
          borderRadius: 8,
          padding: 8,
          background: '#fff',
          width: 180,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          textAlign: 'left',
        },
      })),
    [nodes]
  );

  const flowEdges = useMemo(() => {
    const linkEdges = links
      .map((l) => {
        let sourceId = l.source_node_id;
        let isFragment = false;
        if (!sourceId && l.source_fragment_id) {
          const frag = fragments.find((f) => f.id === l.source_fragment_id);
          sourceId = frag?.ai_node_id;
          isFragment = true;
        }
        if (!sourceId || !nodeMap[sourceId] || !nodeMap[l.target_node_id]) {
          return null;
        }
        return {
          id: `link-${l.id}`,
          source: sourceId,
          target: l.target_node_id,
          label: isFragment ? '一部' : undefined,
        };
      })
      .filter(Boolean);

    const revisionEdges = nodes
      .filter((n) => n.type === 'DESIGN' && n.designs?.revision_parent_id)
      .filter((n) => nodeMap[n.designs.revision_parent_id])
      .map((n) => ({
        id: `rev-${n.id}`,
        source: n.designs.revision_parent_id,
        target: n.id,
        label: '更新',
        style: { strokeDasharray: '4 4' },
      }));

    return [...linkEdges, ...revisionEdges];
  }, [links, fragments, nodes, nodeMap]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      onNodeClick={(_, flowNode) => {
        const n = nodeMap[flowNode.id];
        if (n) onNodeClick(n);
      }}
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

"use client";

import { useMemo, useRef, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const LANE_Y = { AI: 40, DESIGN: 260, MEMO: 480 };
const COLOR = { AI: '#3554d1', DESIGN: '#1f9d6b' };

function labelFor(node) {
  if (node.type === 'AI') {
    return `AI\n${(node.ai_turns?.prompt || '').slice(0, 24)}`;
  }
  if (node.type === 'DESIGN') {
    return `設計案\n${node.designs?.caption?.slice(0, 24) || '(無題)'}`;
  }
  return node.type;
}

function MemoNode({ data }) {
  return (
    <div
      style={{
        background: '#fff6c8',
        border: '1px solid #e8d488',
        borderRadius: 6,
        padding: '10px 12px',
        width: 200,
        minHeight: 90,
        boxShadow: '2px 3px 6px rgba(0,0,0,0.18)',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        transform: 'rotate(-1deg)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 10, color: '#8a6d00', marginBottom: 4 }}>
        MEMO
      </div>
      {data.label}
    </div>
  );
}

const NODE_TYPES = { memo: MemoNode };

export default function ProcessMap({
  nodes,
  links,
  fragments,
  onNodeClick,
  focusRequest,
  onNodeDragEnd,
}) {
  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  // Shiftキーを押している間だけキャンバスのパン（左ドラッグ移動）を有効にする。
  // Shiftを離している間の左ドラッグは、メモなどのノード自体の移動に使う。
  const [panEnabled, setPanEnabled] = useState(false);
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Shift') setPanEnabled(true);
    }
    function handleKeyUp(e) {
      if (e.key === 'Shift') setPanEnabled(false);
    }
    function handleBlur() {
      setPanEnabled(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const flowNodes = useMemo(
    () =>
      nodes.map((n, idx) => {
        const hasManualPosition = n.position_x != null && n.position_y != null;
        const position = hasManualPosition
          ? { x: n.position_x, y: n.position_y }
          : { x: idx * 220 + 40, y: LANE_Y[n.type] ?? 40 };
        if (n.type === 'MEMO') {
          return {
            id: n.id,
            type: 'memo',
            position,
            draggable: true,
            data: { label: (n.memos?.text || '').slice(0, 200) },
          };
        }
        return {
          id: n.id,
          position,
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
        };
      }),
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
        // メモ同士の自動リンクは、関係性が一目でわかるよう専用スタイルにする
        const isMemoRelation =
          !isFragment &&
          nodeMap[sourceId]?.type === 'MEMO' &&
          nodeMap[l.target_node_id]?.type === 'MEMO';
        return {
          id: `link-${l.id}`,
          source: sourceId,
          target: l.target_node_id,
          label: isFragment ? '一部' : isMemoRelation ? '関連' : undefined,
          style: isMemoRelation ? { stroke: '#c9a227', strokeWidth: 2 } : undefined,
          labelStyle: isMemoRelation ? { fill: '#8a6d00', fontSize: 10 } : undefined,
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

  const rfInstanceRef = useRef(null);

  useEffect(() => {
    if (!focusRequest || !rfInstanceRef.current) return;
    const target = flowNodes.find((n) => n.id === focusRequest.nodeId);
    if (target) {
      const width = target.type === 'memo' ? 200 : 180;
      const height = target.type === 'memo' ? 90 : 60;
      rfInstanceRef.current.setCenter(
        target.position.x + width / 2,
        target.position.y + height / 2,
        { zoom: 1.2, duration: 600 }
      );
    }
  }, [focusRequest, flowNodes]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      panOnDrag={panEnabled}
      onInit={(instance) => {
        rfInstanceRef.current = instance;
      }}
      onNodeClick={(_, flowNode) => {
        const n = nodeMap[flowNode.id];
        if (n) onNodeClick(n);
      }}
      onNodeDragStop={(_, flowNode) => {
        if (flowNode.type === 'memo' && onNodeDragEnd) {
          onNodeDragEnd(flowNode.id, flowNode.position.x, flowNode.position.y);
        }
      }}
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
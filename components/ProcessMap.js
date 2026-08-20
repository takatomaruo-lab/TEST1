"use client";

import { useMemo, useRef, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const LANE_Y = { AI: 40, DESIGN: 260, MEMO: 480 };
const COLOR = { AI: '#3554d1', DESIGN: '#1f9d6b' };

// リンクの「できた経緯」ごとの色分け設定
const LINK_STYLE = {
  auto_chain: { stroke: '#c9a227', label: '関連' }, // 直前メモとの自動リンク
  manual_draw: { stroke: '#2f6fed', label: '手動' }, // ハンドルをドラッグして手動作成
  consult_ai: { stroke: '#8a3fd1', label: '相談' }, // 「AIに相談」から生成
  reference: { stroke: '#9a9a9a', label: '参照' }, // 作成時のチェックボックス選択
};

const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: '#fff',
  border: '2px solid #555',
  borderRadius: '50%',
};

function SideHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="left-target" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Left} id="left-source" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Right} id="right-target" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right-source" style={HANDLE_STYLE} />
    </>
  );
}

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
      <SideHandles />
      <div style={{ fontWeight: 700, fontSize: 10, color: '#8a6d00', marginBottom: 4 }}>
        MEMO
      </div>
      {data.label}
    </div>
  );
}

function CardNode({ data }) {
  return (
    <div
      style={{
        border: `2px solid ${data.color || '#999'}`,
        borderRadius: 8,
        padding: 8,
        background: '#fff',
        width: 180,
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        textAlign: 'left',
      }}
    >
      <SideHandles />
      {data.label}
    </div>
  );
}

const NODE_TYPES = { memo: MemoNode, card: CardNode };

export default function ProcessMap({
  nodes,
  links,
  fragments,
  onNodeClick,
  focusRequest,
  onNodeDragEnd,
  onManualConnect,
  onDeleteLink,
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

  // 選択中の線（クリック→Deleteキーで消すため）
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

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
          type: 'card',
          position,
          data: { label: labelFor(n), color: COLOR[n.type] },
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
        const meta = LINK_STYLE[l.link_source] || LINK_STYLE.reference;
        return {
          id: `link-${l.id}`,
          source: sourceId,
          target: l.target_node_id,
          label: isFragment ? '一部' : meta.label,
          style: { stroke: meta.stroke, strokeWidth: 2.5 },
          labelStyle: { fill: meta.stroke, fontSize: 11, fontWeight: 700 },
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
        selectable: false,
      }));

    return [...linkEdges, ...revisionEdges];
  }, [links, fragments, nodes, nodeMap]);

  const edgesForFlow = useMemo(
    () => flowEdges.map((e) => ({ ...e, selected: e.id === selectedEdgeId })),
    [flowEdges, selectedEdgeId]
  );

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
      edges={edgesForFlow}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={true}
      elementsSelectable={true}
      edgesUpdatable={false}
      panOnDrag={panEnabled}
      selectionKeyCode={null}
      deleteKeyCode={['Backspace', 'Delete']}
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
      onConnect={(connection) => {
        if (!connection.source || !connection.target) return;
        if (connection.source === connection.target) return;
        if (onManualConnect) onManualConnect(connection.source, connection.target);
      }}
      onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
      onPaneClick={() => setSelectedEdgeId(null)}
      onEdgesChange={(changes) => {
        changes.forEach((change) => {
          if (change.type === 'remove' && change.id?.startsWith('link-') && onDeleteLink) {
            onDeleteLink(change.id.replace('link-', ''));
          }
        });
      }}
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
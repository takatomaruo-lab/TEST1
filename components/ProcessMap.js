"use client";

import { useMemo, useRef, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Panel, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const LANE_BASE_Y = { AI: 40, DESIGN: 260, MEMO: 480 };
const ROW_GAP = { AI: 90, DESIGN: 90, MEMO: 110 };
const COLUMN_WIDTH = 240;
const COLUMN_MARGIN = 40;
// globals.cssで定義済みのCSS変数を参照し、色の定義をここに重複させない
const COLOR = { AI: 'var(--ai-color)', DESIGN: 'var(--design-color)' };

// 参加者画面でのリンクの見た目は1種類に統一(色分け・ラベル表示は廃止)。
// link_source(できた経緯)は研究者用の内部データとしてDBには引き続き保存される。
const LINK_STROKE_COLOR = '#9a9a9a';

// ハンドルはエッジの接続点計算のためDOM上には残すが、
// 参加者からは見えず(非表示)、ドラッグ操作もできない(無効化)ようにする。
const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: '#fff',
  border: '2px solid #555',
  borderRadius: '50%',
  opacity: 0,
  pointerEvents: 'none',
};

// 長文ノードの省略表示用(2〜3行に折り返しで切り、クリックで全文はNodeDetailPanel側に表示)
const CLAMP_STYLE = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  lineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function SideHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="left-target" style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="left-source" style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="right-target" style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="right-source" style={HANDLE_STYLE} isConnectable={false} />
    </>
  );
}

function typeLabelFor(node) {
  if (node.type === 'AI') return 'AI対話';
  if (node.type === 'DESIGN') return '設計案';
  return node.type;
}

function bodyFor(node) {
  if (node.type === 'AI') return node.ai_turns?.prompt || '';
  if (node.type === 'DESIGN') return node.designs?.caption || '(無題)';
  return '';
}

// 簡易フィルタ（P2-2）の検索対象テキスト。AI対話は質問・回答の両方を対象にする
function searchableText(node) {
  if (node.type === 'AI') return `${node.ai_turns?.prompt || ''} ${node.ai_turns?.response || ''}`;
  if (node.type === 'DESIGN') return node.designs?.caption || '';
  if (node.type === 'MEMO') return node.memos?.text || '';
  return '';
}

function MemoNode({ data }) {
  return (
    <div
      style={{
        background: 'var(--memo-bg)',
        border: '1px solid var(--memo-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        width: 200,
        minHeight: 90,
        boxShadow: '2px 3px 6px rgba(0,0,0,0.18)',
        fontSize: 'var(--font-sm)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        transform: 'rotate(-1deg)',
      }}
    >
      <SideHandles />
      <div style={{ fontWeight: 700, fontSize: 'var(--font-2xs)', color: 'var(--memo-label-color)', marginBottom: 4 }}>
        MEMO
      </div>
      <div style={CLAMP_STYLE}>{data.body}</div>
    </div>
  );
}

function CardNode({ data }) {
  return (
    <div
      style={{
        border: `2px solid ${data.color || 'var(--text-muted)'}`,
        borderRadius: 'var(--radius)',
        padding: 'var(--space-sm)',
        background: 'var(--surface)',
        width: 180,
        fontSize: 'var(--font-sm)',
        whiteSpace: 'pre-wrap',
        textAlign: 'left',
      }}
    >
      <SideHandles />
      <div style={{ fontWeight: 700, fontSize: 'var(--font-2xs)', color: data.color || 'var(--text-muted)', marginBottom: 4 }}>
        {data.typeLabel}
      </div>
      <div style={CLAMP_STYLE}>{data.body}</div>
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
  onAutoArrange,
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

  // 簡易フィルタ（P2-2）：種別の表示/非表示とキーワード検索
  const [typeFilter, setTypeFilter] = useState({ AI: true, DESIGN: true, MEMO: true });
  const [searchText, setSearchText] = useState('');

  function toggleTypeFilter(type) {
    setTypeFilter((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const visibleNodeIds = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const ids = new Set();
    nodes.forEach((n) => {
      if (!typeFilter[n.type]) return;
      if (q && !searchableText(n).toLowerCase().includes(q)) return;
      ids.add(n.id);
    });
    return ids;
  }, [nodes, typeFilter, searchText]);

  // リンク関係(何をもとにしたか)・更新履歴をもとに、各ノードの「段階（depth）」を計算する。
  // depthが大きいほど右側の列に配置され、依存元より必ず右に来る。
  // 新しい中間ノードが挿入されると、その後段のノードのdepthも自動的に増え、右へ押し出される。
  const autoLayout = useMemo(() => {
    const nodeById = {};
    nodes.forEach((n) => (nodeById[n.id] = n));

    const incoming = {};
    nodes.forEach((n) => (incoming[n.id] = []));
    links.forEach((l) => {
      let sourceId = l.source_node_id;
      if (!sourceId && l.source_fragment_id) {
        const frag = fragments.find((f) => f.id === l.source_fragment_id);
        sourceId = frag?.ai_node_id;
      }
      if (sourceId && incoming[l.target_node_id]) {
        incoming[l.target_node_id].push(sourceId);
      }
    });
    nodes.forEach((n) => {
      if (n.type === 'DESIGN' && n.designs?.revision_parent_id && incoming[n.id]) {
        incoming[n.id].push(n.designs.revision_parent_id);
      }
    });

    const depthCache = {};
    function depthOf(id, visiting) {
      if (depthCache[id] !== undefined) return depthCache[id];
      if (visiting.has(id)) return 0; // 循環がある場合の保険
      visiting.add(id);
      let d = 0;
      (incoming[id] || []).forEach((pid) => {
        if (nodeById[pid]) d = Math.max(d, depthOf(pid, visiting) + 1);
      });
      depthCache[id] = d;
      return d;
    }
    nodes.forEach((n) => depthOf(n.id, new Set()));

    // 同じ種別・同じ列(depth)に複数ノードが来る場合は、作成順に縦へ積んで重なりを避ける
    const sorted = [...nodes].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    const rowCounter = {};
    const positions = {};
    sorted.forEach((n) => {
      const depth = depthCache[n.id] ?? 0;
      const rowKey = `${n.type}:${depth}`;
      const row = rowCounter[rowKey] ?? 0;
      rowCounter[rowKey] = row + 1;
      positions[n.id] = {
        x: COLUMN_MARGIN + depth * COLUMN_WIDTH,
        y: (LANE_BASE_Y[n.type] ?? 40) + row * (ROW_GAP[n.type] ?? 90),
      };
    });
    return positions;
  }, [nodes, links, fragments]);

  const flowNodes = useMemo(
    () =>
      nodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map((n) => {
          const hasManualPosition = n.position_x != null && n.position_y != null;
          const position = hasManualPosition
            ? { x: n.position_x, y: n.position_y }
            : autoLayout[n.id] || { x: COLUMN_MARGIN, y: LANE_BASE_Y[n.type] ?? 40 };
          if (n.type === 'MEMO') {
            return {
              id: n.id,
              type: 'memo',
              position,
              draggable: true,
              data: { body: n.memos?.text || '' },
            };
          }
          return {
            id: n.id,
            type: 'card',
            position,
            draggable: n.type === 'DESIGN' || n.type === 'AI',
            data: { typeLabel: typeLabelFor(n), body: bodyFor(n), color: COLOR[n.type] },
          };
        }),
    [nodes, autoLayout, visibleNodeIds]
  );

  // ノードの左右の位置関係から、一番近いハンドル同士を自動で選ぶ
  const posMap = useMemo(() => {
    const m = {};
    flowNodes.forEach((n) => (m[n.id] = n.position));
    return m;
  }, [flowNodes]);

  function pickHandles(sourceId, targetId) {
    const sp = posMap[sourceId];
    const tp = posMap[targetId];
    if (!sp || !tp) return { sourceHandle: undefined, targetHandle: undefined };
    const sourceIsLeft = sp.x <= tp.x;
    return {
      sourceHandle: sourceIsLeft ? 'right-source' : 'left-source',
      targetHandle: sourceIsLeft ? 'left-target' : 'right-target',
    };
  }

  const flowEdges = useMemo(() => {
    const linkEdges = links
      .map((l) => {
        let sourceId = l.source_node_id;
        if (!sourceId && l.source_fragment_id) {
          const frag = fragments.find((f) => f.id === l.source_fragment_id);
          sourceId = frag?.ai_node_id;
        }
        if (!sourceId || !nodeMap[sourceId] || !nodeMap[l.target_node_id]) {
          return null;
        }
        if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(l.target_node_id)) {
          return null;
        }
        const { sourceHandle, targetHandle } = pickHandles(sourceId, l.target_node_id);
        return {
          id: `link-${l.id}`,
          source: sourceId,
          target: l.target_node_id,
          sourceHandle,
          targetHandle,
          style: { stroke: LINK_STROKE_COLOR, strokeWidth: 2 },
        };
      })
      .filter(Boolean);

    const revisionEdges = nodes
      .filter((n) => n.type === 'DESIGN' && n.designs?.revision_parent_id)
      .filter((n) => nodeMap[n.designs.revision_parent_id])
      .filter(
        (n) => visibleNodeIds.has(n.id) && visibleNodeIds.has(n.designs.revision_parent_id)
      )
      .map((n) => {
        const { sourceHandle, targetHandle } = pickHandles(
          n.designs.revision_parent_id,
          n.id
        );
        return {
          id: `rev-${n.id}`,
          source: n.designs.revision_parent_id,
          target: n.id,
          sourceHandle,
          targetHandle,
          label: '更新',
          style: { strokeDasharray: '4 4' },
          selectable: false,
        };
      });

    return [...linkEdges, ...revisionEdges];
  }, [links, fragments, nodes, nodeMap, posMap, visibleNodeIds]);

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
      nodesConnectable={false}
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
        if (onNodeDragEnd) {
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
      <Panel position="top-left">
        <div className="map-filter">
          <input
            type="text"
            placeholder="キーワードで絞り込み"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <div className="map-filter-types">
            <label className="map-filter-checkbox">
              <input
                type="checkbox"
                checked={typeFilter.AI}
                onChange={() => toggleTypeFilter('AI')}
              />
              AI対話
            </label>
            <label className="map-filter-checkbox">
              <input
                type="checkbox"
                checked={typeFilter.DESIGN}
                onChange={() => toggleTypeFilter('DESIGN')}
              />
              設計案
            </label>
            <label className="map-filter-checkbox">
              <input
                type="checkbox"
                checked={typeFilter.MEMO}
                onChange={() => toggleTypeFilter('MEMO')}
              />
              思考メモ
            </label>
          </div>
        </div>
      </Panel>
      <Panel position="top-right">
        <button
          type="button"
          className="btn-secondary"
          onClick={onAutoArrange}
          title="接続関係・作成時刻をもとに配置を再計算します（手動で動かした位置はリセットされます）"
        >
          自動整列
        </button>
      </Panel>
    </ReactFlow>
  );
}
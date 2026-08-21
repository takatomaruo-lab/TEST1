"use client";

import { useMemo, useRef, useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Panel, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// レーン（種別ごとのY座標固定）は廃止し、リンク関係から分岐する形で配置する。
// 種別は色で見分ける。
const COLUMN_WIDTH = 260; // 1段（depth）あたりの横間隔
const COLUMN_MARGIN = 40; // 左端の余白
const TOP_MARGIN = 40;    // 上端の余白
const ROW_GAP = 44;       // 同じ段に複数ノードが並ぶときの縦間隔

// globals.cssで定義済みのCSS変数を参照し、色の定義をここに重複させない
// 種別は「AI対話」「思考メモ」の2種類。
// DESIGNは過去セッションの記録で、現在は思考メモに統合済みのため同じ色で表示する
const COLOR = {
  AI: 'var(--ai-pill)',
  DESIGN: 'var(--memo-pill)',
  MEMO: 'var(--memo-pill)',
};

// 参加者画面でのリンクの見た目は1種類に統一(色分け・ラベル表示は廃止)。
// link_source(できた経緯)は研究者用の内部データとしてDBには引き続き保存される。
const LINK_STROKE_COLOR = '#9a9a9a';

// ノードに表示する文字数の上限。全文はクリックで詳細パネルに表示する
const LABEL_MAX_CHARS = 30;

// ハンドルはエッジの接続点計算のためDOM上には残すが、
// 参加者からは見えず(非表示)、ドラッグ操作もできない(無効化)ようにする。
const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: '#fff',
  border: '2px solid #555',
  borderRadius: '50%',
  opacity: 0,
  pointerEvents: 'none',
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

// 改行・連続空白を1つの空白にまとめ、上限文字数を超える分は「…」で省略する
function truncate(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(空)';
  return t.length > LABEL_MAX_CHARS ? `${t.slice(0, LABEL_MAX_CHARS)}…` : t;
}

function bodyFor(node) {
  if (node.type === 'AI') return truncate(node.ai_turns?.prompt);
  if (node.type === 'DESIGN') return truncate(node.designs?.caption || '(無題)');
  if (node.type === 'MEMO') {
    const memo = node.memos;
    if (memo?.text) return truncate(memo.text);
    return memo?.image_path ? '(画像のみ)' : '(空)';
  }
  return node.type;
}

// 簡易フィルタ（P2-2）の検索対象テキスト。AI対話は質問・回答の両方を対象にする
function searchableText(node) {
  if (node.type === 'AI') return `${node.ai_turns?.prompt || ''} ${node.ai_turns?.response || ''}`;
  if (node.type === 'DESIGN') return node.designs?.caption || '';
  if (node.type === 'MEMO') return node.memos?.text || '';
  return '';
}

// 更新前の記録のノードID。思考メモ・過去の設計案どちらにも対応する
function revisionParentOf(node) {
  if (node.type === 'MEMO') return node.memos?.revision_parent_id || null;
  if (node.type === 'DESIGN') return node.designs?.revision_parent_id || null;
  return null;
}

// ピル型ノード。幅は文字数に応じて自動で決まる
function PillNode({ data }) {
  return (
    <div
      style={{
        background: data.color,
        color: '#fff',
        borderRadius: 'var(--radius-pill)',
        padding: '6px 14px',
        fontSize: 'var(--font-sm)',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        width: 'max-content',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }}
      title={data.fullText}
    >
      <SideHandles />
      {data.body}
    </div>
  );
}

const NODE_TYPES = { pill: PillNode };

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
  showAddMemo,
  onAddMemo,
}) {
  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  // Shiftキーを押している間だけキャンバスのパン（左ドラッグ移動）を有効にする。
  // Shiftを離している間の左ドラッグは、ノード自体の移動に使う。
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
  const [typeFilter, setTypeFilter] = useState({ AI: true, MEMO: true });
  const [searchText, setSearchText] = useState('');

  function toggleTypeFilter(type) {
    setTypeFilter((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const visibleNodeIds = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const ids = new Set();
    nodes.forEach((n) => {
      // DESIGNは過去セッションの記録。思考メモに統合済みのため同じ扱いにする
      const filterKey = n.type === 'DESIGN' ? 'MEMO' : n.type;
      if (!typeFilter[filterKey]) return;
      if (q && !searchableText(n).toLowerCase().includes(q)) return;
      ids.add(n.id);
    });
    return ids;
  }, [nodes, typeFilter, searchText]);

  // リンク関係(何をもとにしたか)・更新履歴をもとに自動配置する。
  // ・横方向：もとにした記録より必ず右の段（depth）に置く
  // ・縦方向：もとにした記録の高さに寄せ、重なる場合は下へずらす
  const autoLayout = useMemo(() => {
    const nodeById = {};
    nodes.forEach((n) => (nodeById[n.id] = n));

    // 各ノードが「何をもとにしたか」（＝入ってくる線の元）を集める
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
      const parentId = revisionParentOf(n);
      if (parentId && incoming[n.id]) incoming[n.id].push(parentId);
    });

    // 段（depth）を計算する。新しい中間ノードが挿入されると後段も自動的に右へ押し出される
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

    // 段ごとにまとめる
    const columns = {};
    nodes.forEach((n) => {
      const d = depthCache[n.id] ?? 0;
      if (!columns[d]) columns[d] = [];
      columns[d].push(n);
    });
    const maxDepth = Object.keys(columns).reduce((a, b) => Math.max(a, Number(b)), 0);

    // 左の段から順に、もとにした記録の高さの平均に寄せて配置する
    const yById = {};
    const positions = {};
    for (let d = 0; d <= maxDepth; d++) {
      const col = columns[d] || [];
      const entries = col.map((n) => {
        const parentYs = (incoming[n.id] || [])
          .map((pid) => yById[pid])
          .filter((y) => y !== undefined);
        const desired = parentYs.length
          ? parentYs.reduce((s, y) => s + y, 0) / parentYs.length
          : null;
        return { node: n, desired };
      });
      // もとにした記録がないノード（＝起点）は作成順に、それ以外は寄せたい高さ順に並べる
      entries.sort((a, b) => {
        if (a.desired == null && b.desired == null) {
          return new Date(a.node.created_at) - new Date(b.node.created_at);
        }
        if (a.desired == null) return 1;
        if (b.desired == null) return -1;
        return a.desired - b.desired;
      });

      let cursor = TOP_MARGIN;
      entries.forEach(({ node, desired }) => {
        const y = Math.max(cursor, desired ?? TOP_MARGIN);
        yById[node.id] = y;
        positions[node.id] = { x: COLUMN_MARGIN + d * COLUMN_WIDTH, y };
        cursor = y + ROW_GAP;
      });
    }
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
            : autoLayout[n.id] || { x: COLUMN_MARGIN, y: TOP_MARGIN };
          return {
            id: n.id,
            type: 'pill',
            position,
            draggable: true,
            data: {
              body: bodyFor(n),
              fullText: searchableText(n),
              color: COLOR[n.type] || 'var(--text-muted)',
            },
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
          type: 'smoothstep',
          pathOptions: { borderRadius: 12 },
          style: { stroke: LINK_STROKE_COLOR, strokeWidth: 1.5 },
        };
      })
      .filter(Boolean);

    const revisionEdges = nodes
      .filter((n) => {
        const pid = revisionParentOf(n);
        return pid && nodeMap[pid] && visibleNodeIds.has(n.id) && visibleNodeIds.has(pid);
      })
      .map((n) => {
        const parentId = revisionParentOf(n);
        const { sourceHandle, targetHandle } = pickHandles(parentId, n.id);
        return {
          id: `rev-${n.id}`,
          source: parentId,
          target: n.id,
          sourceHandle,
          targetHandle,
          type: 'smoothstep',
          pathOptions: { borderRadius: 12 },
          label: '更新',
          style: { stroke: LINK_STROKE_COLOR, strokeWidth: 1.5, strokeDasharray: '4 4' },
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
      // ピルの幅は文字数から概算する（1文字あたり約12px＋左右の余白）
      const width = (target.data.body?.length || 0) * 12 + 28;
      const height = 30;
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
              <span className="map-filter-swatch map-filter-swatch-AI" />
              AI対話
            </label>
            <label className="map-filter-checkbox">
              <input
                type="checkbox"
                checked={typeFilter.MEMO}
                onChange={() => toggleTypeFilter('MEMO')}
              />
              <span className="map-filter-swatch map-filter-swatch-MEMO" />
              思考メモ
            </label>
          </div>
          {showAddMemo && (
            <button type="button" className="btn map-filter-add" onClick={onAddMemo}>
              ＋思考メモ
            </button>
          )}
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
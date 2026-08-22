"use client";

import { useMemo, useRef, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// レーン（種別ごとのY座標固定）は廃止し、リンク関係から分岐する形で配置する。
// 種別は色で見分ける。
const COLUMN_WIDTH = 260; // 1段（depth）あたりの横間隔
const COLUMN_MARGIN = 40; // 左端の余白
const TOP_MARGIN = 40;    // 上端の余白
const ROW_GAP = 88;       // 同じ段に複数ノードが並ぶときの縦間隔
// 不採用にした記録は採用中の記録と混ざらないよう、下側に離して置く
const REJECTED_ZONE_GAP = 160;
// ピル1個分の高さの目安。ゾーンの区切り線を引く位置の計算に使う
const PILL_APPROX_HEIGHT = 32;

// パレット（AIメモ=サフラン／思考メモ=ムーンストーン／文字=ガンメタル）。
// 線のグラデーション計算に実際の色値が必要なため、ここではCSS変数ではなく実値を持つ。
// globals.css側の --ai-pill / --memo-pill と必ず同じ値にすること。
const PALETTE = {
  saffron: '#FFC64F',
  moonstone: '#519CAB',
  gunmetal: '#20373B',
  // 不採用にした記録の色。globals.css の --pal-muted と必ず同じ値にすること
  muted: '#9AA5A8',
};

// 種別は「AIメモ」「思考メモ」の2種類。
// ・AIメモ  = AIチャット由来の記録（type='AI'）＋ 手動作成のAIメモ（memos.is_ai = true）
// ・思考メモ = 参加者自身の思考（memos.is_ai = false）
// DESIGNは過去セッションの記録で、思考メモに統合済みのため同じ色で表示する
function isAiNode(node) {
  if (node.type === 'AI') return true;
  if (node.type === 'MEMO') return !!node.memos?.is_ai;
  return false;
}

// 不採用にした記録（rejected_at あり）は種別によらず灰色にする
function isRejected(node) {
  return !!node.rejected_at;
}

function colorForNode(node) {
  if (isRejected(node)) return PALETTE.muted;
  return isAiNode(node) ? PALETTE.saffron : PALETTE.moonstone;
}

// ノードに表示する文字数の上限。最大3行（CSS側の -webkit-line-clamp）に収まる量。
// 全文はクリックで詳細パネルに表示する
const LABEL_MAX_CHARS = 30;

function SideHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="left-target" className="pill-handle" />
      <Handle type="source" position={Position.Left} id="left-source" className="pill-handle" />
      <Handle type="target" position={Position.Right} id="right-target" className="pill-handle" />
      <Handle type="source" position={Position.Right} id="right-source" className="pill-handle" />
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

// 簡易フィルタの検索対象テキスト。AIメモは質問・回答の両方を対象にする
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

// ピル型ノード。AIメモ・思考メモとも同じ形・同じ文字色で、塗りの色だけが異なる
// ダブルクリックで本文をその場で書き換えられる（AIチャット由来の記録を除く）
function PillNode({ data }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEditing() {
    if (!data.editable) return;
    setDraft(data.rawText || '');
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (data.rawText || '')) {
      data.onCommitText(next);
    }
  }

  if (editing) {
    return (
      <div className="pill-node pill-node-editing" style={{ background: data.color }}>
        <SideHandles />
        <input
          ref={inputRef}
          className="pill-edit-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
          // キー入力がReact Flowのショートカット（Deleteなど）に拾われないようにする
          onKeyDownCapture={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <div
      className={`pill-node${data.rejected ? ' is-rejected' : ''}`}
      style={{ background: data.color }}
      title={data.editable ? 'ダブルクリックで編集' : undefined}
      onDoubleClick={startEditing}
    >
      <SideHandles />
      <span className="pill-body">{data.body}</span>
      {/* 詳細パネルはこのマークからのみ開く（ノード本体のクリックでは開かない） */}
      <button
        type="button"
        className="pill-info"
        title="詳細を見る"
        aria-label="詳細を見る"
        // 「i」の文字はそのメモの色にする（不採用のときは灰色）
        style={{ color: data.color }}
        onClick={(e) => {
          e.stopPropagation();
          data.onOpenDetail();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        i
      </button>
    </div>
  );
}

// 線の色。同じ種別同士はその種別の色、種別をまたぐ場合は
// 「始点＝始点ノードの色、終点＝終点ノードの色」になるグラデーションを引く
function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const fromColor = data?.fromColor || PALETTE.gunmetal;
  const toColor = data?.toColor || PALETTE.gunmetal;
  const needsGradient = fromColor !== toColor;
  const gradientId = `edge-gradient-${id}`;

  return (
    <>
      {needsGradient && (
        <defs>
          {/* userSpaceOnUse で実座標を指定し、線の向きと色の向きを一致させる */}
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={fromColor} />
            <stop offset="100%" stopColor={toColor} />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: needsGradient ? `url(#${gradientId})` : fromColor,
          strokeWidth: selected ? 4 : 2.5,
          strokeDasharray: data?.dashed ? '5 4' : undefined,
        }}
      />
    </>
  );
}

// 採用中のゾーンと不採用ゾーンの境目に引く区切り。
// ノードとして置くのでキャンバスと一緒に動くが、選択・移動・削除はできない
function ZoneDividerNode({ data }) {
  return (
    <div className="zone-divider" style={{ width: data.width }}>
      <span className="zone-divider-label">不採用にしたAIメモ</span>
    </div>
  );
}

const NODE_TYPES = { pill: PillNode, zoneDivider: ZoneDividerNode };
const EDGE_TYPES = { gradient: GradientEdge };

export default function ProcessMap({
  nodes,
  links,
  fragments,
  onNodeClick,
  focusRequest,
  onNodeDragEnd,
  onManualConnect,
  onDeleteLink,
  showAddMemo,
  onAddMemo,
  onEditNodeText,
  onToggleReject,
  onDeleteNode,
}) {
  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  // 選択中の線（クリック→Deleteキーで消すため）
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  // 簡易フィルタ：種別の表示/非表示とキーワード検索
  const [typeFilter, setTypeFilter] = useState({ AI: true, MEMO: true });
  const [searchText, setSearchText] = useState('');

  function toggleTypeFilter(type) {
    setTypeFilter((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const visibleNodeIds = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const ids = new Set();
    nodes.forEach((n) => {
      // 手動作成のAIメモもAIメモ側として絞り込む
      const filterKey = isAiNode(n) ? 'AI' : 'MEMO';
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

    // 左の段から順に、もとにした記録の高さの平均に寄せて配置する。
    // 採用中の記録を上のゾーン、不採用にした記録を下のゾーンに分けて置き、
    // 自動整列したときに両者が混ざらないようにする。
    const yById = {};
    const positions = {};

    function placeZone(members, topMargin) {
      const inZone = new Set(members.map((n) => n.id));
      let zoneBottom = topMargin;
      for (let d = 0; d <= maxDepth; d++) {
        const col = (columns[d] || []).filter((n) => inZone.has(n.id));
        if (col.length === 0) continue;
        const entries = col.map((n) => {
          // 同じゾーン内のもとにした記録だけを高さ合わせの対象にする
          const parentYs = (incoming[n.id] || [])
            .filter((pid) => inZone.has(pid))
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

        let cursor = topMargin;
        entries.forEach(({ node, desired }) => {
          const y = Math.max(cursor, desired ?? topMargin);
          yById[node.id] = y;
          positions[node.id] = { x: COLUMN_MARGIN + d * COLUMN_WIDTH, y };
          cursor = y + ROW_GAP;
          if (cursor > zoneBottom) zoneBottom = cursor;
        });
      }
      return zoneBottom;
    }

    const activeNodes = nodes.filter((n) => !isRejected(n));
    const rejectedNodes = nodes.filter((n) => isRejected(n));

    const activeBottom = placeZone(activeNodes, TOP_MARGIN);
    if (rejectedNodes.length > 0) {
      placeZone(rejectedNodes, activeBottom + REJECTED_ZONE_GAP);
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
              color: colorForNode(n),
              // AIチャット由来の記録は実際のやり取りそのものなので編集させない
              editable: n.type === 'MEMO',
              rejected: isRejected(n),
              rawText: n.type === 'MEMO' ? n.memos?.text || '' : '',
              onCommitText: (newText) => {
                if (onEditNodeText) onEditNodeText(n.id, newText);
              },
              onOpenDetail: () => {
                if (onNodeClick) onNodeClick(n);
              },
            },
          };
        }),
    [nodes, autoLayout, visibleNodeIds]
  );

  // 不採用ゾーンの区切り線。表示中に不採用の記録が1件もなければ引かない。
  // 手動で動かしたノードも含めた実際の位置から境目を求めるので、
  // 自動整列していない状態でも線が実態からずれない
  const zoneDivider = useMemo(() => {
    const visible = nodes.filter((n) => visibleNodeIds.has(n.id));
    const rejected = visible.filter(isRejected);
    if (rejected.length === 0) return null;
    const active = visible.filter((n) => !isRejected(n));

    const posOf = (n) =>
      n.position_x != null && n.position_y != null
        ? { x: n.position_x, y: n.position_y }
        : autoLayout[n.id] || { x: COLUMN_MARGIN, y: TOP_MARGIN };

    const rejectedTop = Math.min(...rejected.map((n) => posOf(n).y));
    const y = active.length
      ? // 採用側の一番下と不採用側の一番上のちょうど中間に引く
        (Math.max(...active.map((n) => posOf(n).y)) + PILL_APPROX_HEIGHT + rejectedTop) / 2
      : rejectedTop - REJECTED_ZONE_GAP / 2;

    const xs = visible.map((n) => posOf(n).x);
    const left = Math.min(...xs) - 24;
    const right = Math.max(...xs) + COLUMN_WIDTH;
    return { x: left, y, width: Math.max(right - left, 360) };
  }, [nodes, visibleNodeIds, autoLayout]);

  // 区切り線はピルより後ろに描く。React Flowの選択・削除の対象からも外す
  const nodesForFlow = useMemo(() => {
    if (!zoneDivider) return flowNodes;
    return [
      {
        id: '__zone-divider__',
        type: 'zoneDivider',
        position: { x: zoneDivider.x, y: zoneDivider.y },
        data: { width: zoneDivider.width },
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        zIndex: -1,
      },
      ...flowNodes,
    ];
  }, [flowNodes, zoneDivider]);

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

  function colorOf(nodeId) {
    const n = nodeMap[nodeId];
    return n ? colorForNode(n) : PALETTE.gunmetal;
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
        // 端のどちらかが不採用なら点線にして、採用中のつながりと見分けられるようにする
        const touchesRejected =
          isRejected(nodeMap[sourceId]) || isRejected(nodeMap[l.target_node_id]);
        return {
          id: `link-${l.id}`,
          source: sourceId,
          target: l.target_node_id,
          sourceHandle,
          targetHandle,
          type: 'gradient',
          data: {
            fromColor: colorOf(sourceId),
            toColor: colorOf(l.target_node_id),
            dashed: touchesRejected,
          },
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
          type: 'gradient',
          label: '更新',
          selectable: false,
          data: {
            fromColor: colorOf(parentId),
            toColor: colorOf(n.id),
            dashed: true,
          },
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
      // ピルは最大3行に折り返すので、幅・高さを行数から概算する
      const len = target.data.body?.length || 0;
      const perLine = 12; // 1行あたりの文字数の目安
      const lines = Math.min(3, Math.max(1, Math.ceil(len / perLine)));
      const width = Math.min(len, perLine) * 12 + 28 + 22; // 22 はインフォメーションマークの分
      const height = 12 + lines * 18;
      rfInstanceRef.current.setCenter(
        target.position.x + width / 2,
        target.position.y + height / 2,
        { zoom: 1.2, duration: 600 }
      );
    }
  }, [focusRequest, flowNodes]);

  return (
    <ReactFlow
      nodes={nodesForFlow}
      edges={edgesForFlow}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={false}
      nodesConnectable={true}
      elementsSelectable={true}
      edgesUpdatable={false}
      panOnDrag={true}
      selectionKeyCode={null}
      deleteKeyCode={['Backspace', 'Delete']}
      connectionLineStyle={{ stroke: PALETTE.gunmetal, strokeWidth: 2.5 }}
      onInit={(instance) => {
        rfInstanceRef.current = instance;
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
      onNodesDelete={(deleted) => {
        // AIメモ＝削除せず「不採用」に切り替える（研究データとして残すため）
        // 思考メモ＝参加者が自分で作った記録なので削除する
        deleted.forEach((d) => {
          const n = nodeMap[d.id];
          if (!n) return;
          if (isAiNode(n)) {
            if (onToggleReject) onToggleReject(n);
          } else if (onDeleteNode) {
            onDeleteNode(n);
          }
        });
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
      <Background color="#9dc4d0" gap={20} />
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
              AIメモ
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
            <div className="map-filter-actions">
              <button
                type="button"
                className="btn map-add-memo"
                onClick={() => onAddMemo(false)}
              >
                ＋思考メモ
              </button>
            </div>
          )}
        </div>
      </Panel>
      <Panel position="bottom-center">
        <p className="map-hint">
          丸をドラッグで線を引く／Deleteで線を削除・AIメモを不採用・思考メモを削除
        </p>
      </Panel>
    </ReactFlow>
  );
}
"use client";

import { getMode } from '../lib/aiModes';

function sourceLabel(link, nodeMap, fragments) {
  if (link.source_fragment_id) {
    const frag = fragments.find((f) => f.id === link.source_fragment_id);
    return `AI回答の一部：「${(frag?.selected_text || '').slice(0, 24)}」`;
  }
  const n = nodeMap[link.source_node_id];
  if (!n) return '(不明)';
  if (n.type === 'AI') return `AIメモ：${(n.ai_turns?.prompt || '').slice(0, 20)}`;
  if (n.type === 'DESIGN') return `思考メモ：${n.designs?.caption || '(無題)'}`;
  if (n.type === 'MEMO') {
    const label = (n.memos?.text || '').slice(0, 20);
    const kind = n.memos?.is_ai ? 'AIメモ' : '思考メモ';
    if (label) return `${kind}：${label}`;
    return n.memos?.image_path ? `${kind}：(画像のみ)` : `${kind}：(空)`;
  }
  return '(不明)';
}

export default function NodeDetailPanel({
  node,
  links,
  fragments,
  nodeMap,
  condition,
  onClose,
  onConsultAI,
  onRevise,
  onDeleteLink,
  onToggleReject,
  onDeleteNode,
}) {
  if (!node) return null;

  // AIチャット由来の記録と、手動作成のAIメモの両方をAIメモとして扱う
  const isAi = node.type === 'AI' || !!node.memos?.is_ai;
  const rejected = !!node.rejected_at;

  const incomingLinks = links.filter((l) => l.target_node_id === node.id);

  return (
    // 詳細を開いている間は背景を暗くして作業対象に集中させる。
    // オーバーレイ（＝パネルの外側）をクリックすると閉じる
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="btn-secondary" onClick={onClose} style={{ float: 'right' }}>
          閉じる
        </button>
        <span className={`badge badge-${isAi ? 'AI' : 'MEMO'}`}>
          {isAi ? 'AIメモ' : '思考メモ'}
        </span>
        {rejected && <span className="badge badge-rejected">不採用</span>}

        {node.type === 'AI' && (
          <div>
            {node.ai_turns?.mode && (
              <span className="mode-tag">{getMode(node.ai_turns.mode).label}モード</span>
            )}
            <h3>プロンプト</h3>
            <p>{node.ai_turns?.prompt}</p>
            <h3>AI回答</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{node.ai_turns?.response}</p>
          </div>
        )}

        {/* DESIGNは過去セッションの記録。現在は思考メモに統合済み */}
        {node.type === 'DESIGN' && (
          <div>
            <h3>思考メモ</h3>
            {node.designs?.caption && (
              <p style={{ whiteSpace: 'pre-wrap' }}>{node.designs.caption}</p>
            )}
            {node.designs?.image_path && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={node.designs.image_path} alt="添付画像" className="design-image" />
            )}
          </div>
        )}

        {node.type === 'MEMO' && (
          <div>
            <h3>{isAi ? 'AIメモ' : '思考メモ'}</h3>
            {node.memos?.text && (
              <p style={{ whiteSpace: 'pre-wrap' }}>{node.memos.text}</p>
            )}
            {node.memos?.image_path && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={node.memos.image_path} alt="添付画像" className="design-image" />
            )}
          </div>
        )}

        {condition === 'TOOL' && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => onConsultAI(node)}>
              これについてAIに相談
            </button>
            {node.type !== 'AI' && (
              <button className="btn-secondary" onClick={() => onRevise(node)}>
                このメモを更新
              </button>
            )}
            {/* AIメモは不採用にして残し、思考メモは削除する */}
            {isAi ? (
              <button className="btn-secondary" onClick={() => onToggleReject(node)}>
                {rejected ? '不採用を取り消す' : '不採用にする'}
              </button>
            ) : (
              <button className="btn-danger" onClick={() => onDeleteNode(node)}>
                このメモを削除
              </button>
            )}
          </div>
        )}

        <h3 style={{ marginTop: 20 }}>この記録につながった項目</h3>
        {incomingLinks.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>なし</p>
        )}
        {incomingLinks.map((l) => (
          <div className="link-list-item" key={l.id}>
            <span>{sourceLabel(l, nodeMap, fragments)}</span>
            {condition === 'TOOL' && (
              <button className="btn-danger" onClick={() => onDeleteLink(l.id)}>
                解除
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
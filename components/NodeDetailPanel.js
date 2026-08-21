"use client";

function sourceLabel(link, nodeMap, fragments) {
  if (link.source_fragment_id) {
    const frag = fragments.find((f) => f.id === link.source_fragment_id);
    return `AI回答の一部：「${(frag?.selected_text || '').slice(0, 24)}」`;
  }
  const n = nodeMap[link.source_node_id];
  if (!n) return '(不明)';
  if (n.type === 'AI') return `AI対話：${(n.ai_turns?.prompt || '').slice(0, 20)}`;
  if (n.type === 'DESIGN') return `設計案：${n.designs?.caption || '(無題)'}`;
  if (n.type === 'MEMO') return `思考メモ：${(n.memos?.text || '').slice(0, 20)}`;
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
  onSaveFragment,
}) {
  if (!node) return null;

  const incomingLinks = links.filter((l) => l.target_node_id === node.id);

  return (
    <div className="detail-panel">
      <button className="btn-secondary" onClick={onClose} style={{ float: 'right' }}>
        閉じる
      </button>
      <span className={`badge badge-${node.type}`}>{node.type}</span>

      {node.type === 'AI' && (
        <div>
          <h3>プロンプト</h3>
          <p>{node.ai_turns?.prompt}</p>
          <h3>AI回答</h3>
          <SelectableResponse
            text={node.ai_turns?.response || ''}
            onSave={(selectedText) => onSaveFragment(node.id, selectedText)}
          />
        </div>
      )}

      {node.type === 'DESIGN' && (
        <div>
          <h3>{node.designs?.caption || '設計案'}</h3>
          {node.designs?.image_path && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={node.designs.image_path} alt="設計案" className="design-image" />
          )}
        </div>
      )}

      {node.type === 'MEMO' && (
        <div>
          <h3>思考メモ</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{node.memos?.text}</p>
        </div>
      )}

      {condition === 'TOOL' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => onConsultAI(node)}>
            これについてAIに相談
          </button>
          {node.type === 'DESIGN' && (
            <button className="btn-secondary" onClick={() => onRevise(node)}>
              この案を更新
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
  );
}

function SelectableResponse({ text, onSave }) {
  function handleMouseUp() {
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : '';
    if (selectedText.length > 0) {
      const box = document.getElementById('fragment-save-box');
      if (box) box.dataset.text = selectedText;
      const label = document.getElementById('fragment-save-label');
      if (label) label.textContent = `選択中：「${selectedText.slice(0, 30)}」`;
    }
  }

  return (
    <div>
      <p style={{ whiteSpace: 'pre-wrap' }} onMouseUp={handleMouseUp}>
        {text}
      </p>
      <div id="fragment-save-box">
        <span id="fragment-save-label" style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }} />
        <br />
        <button
          type="button"
          className="select-fragment-btn"
          onClick={() => {
            const box = document.getElementById('fragment-save-box');
            const t = box?.dataset.text;
            if (t) {
              onSave(t);
              box.dataset.text = '';
              const label = document.getElementById('fragment-save-label');
              if (label) label.textContent = '';
            }
          }}
        >
          選択したテキストを参照として保存
        </button>
      </div>
    </div>
  );
}
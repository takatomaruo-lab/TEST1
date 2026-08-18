"use client";

import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function candidateLabel(item) {
  if (item.kind === 'fragment') {
    return `AI回答の一部：「${item.selected_text.slice(0, 40)}」`;
  }
  if (item.type === 'AI') {
    return `AI対話：${(item.ai_turns?.prompt || '').slice(0, 30)}`;
  }
  if (item.type === 'DESIGN') {
    return `設計案：${item.designs?.caption || '(無題)'}`;
  }
  if (item.type === 'MEMO') {
    return `思考メモ：${(item.memos?.text || '').slice(0, 30)}`;
  }
  return '(不明なノード)';
}

export default function AddMemoModal({ sessionId, nodes, fragments, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const candidates = [
    ...nodes.map((n) => ({ kind: 'node', ...n })),
    ...fragments.map((f) => ({ kind: 'fragment', ...f })),
  ];

  function toggle(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) {
      setError('内容を入力してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: node, error: nodeErr } = await supabase
        .from('nodes')
        .insert({ session_id: sessionId, type: 'MEMO' })
        .select()
        .single();
      if (nodeErr) throw nodeErr;

      const { error: memoErr } = await supabase
        .from('memos')
        .insert({ node_id: node.id, text: text.trim() });
      if (memoErr) throw memoErr;

      const linkRows = [];
      for (const c of candidates) {
        const key = c.kind === 'fragment' ? `fragment:${c.id}` : `node:${c.id}`;
        if (selected[key]) {
          linkRows.push({
            source_node_id: c.kind === 'fragment' ? null : c.id,
            source_fragment_id: c.kind === 'fragment' ? c.id : null,
            target_node_id: node.id,
          });
        }
      }
      if (linkRows.length > 0) {
        await supabase.from('links').insert(linkRows);
      }

      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>思考メモを追加</h2>

        <label>
          内容
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="気づき・違和感・判断理由など自由に"
          />
        </label>

        <label>この考えは何を見て生まれましたか？（任意・複数選択可）</label>
        <div className="candidate-list">
          {candidates.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              まだ選択できる記録がありません
            </p>
          )}
          {candidates.map((c) => {
            const key = c.kind === 'fragment' ? `fragment:${c.id}` : `node:${c.id}`;
            return (
              <div className="candidate-item" key={key}>
                <input
                  type="checkbox"
                  checked={!!selected[key]}
                  onChange={() => toggle(key)}
                />
                <span>{candidateLabel(c)}</span>
              </div>
            );
          })}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

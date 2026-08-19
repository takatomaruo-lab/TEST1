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

export default function AddDesignModal({
  sessionId,
  nodes,
  fragments,
  revisionTarget,
  onClose,
  onCreated,
}) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
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
    if (!file) {
      setError('画像を選択してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const path = `${sessionId}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('design-images')
        .upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage
        .from('design-images')
        .getPublicUrl(path);

      const { data: node, error: nodeErr } = await supabase
        .from('nodes')
        .insert({ session_id: sessionId, type: 'DESIGN' })
        .select()
        .single();
      if (nodeErr) throw nodeErr;

      const { error: designErr } = await supabase.from('designs').insert({
        node_id: node.id,
        image_path: pub.publicUrl,
        caption,
        revision_parent_id: revisionTarget ? revisionTarget.id : null,
      });
      if (designErr) throw designErr;

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
        <h2>{revisionTarget ? '設計案を更新' : '設計案を追加'}</h2>

        <label>
          画像（スケッチ・図面・模型写真など）
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        <label>
          キャプション（任意）
          <textarea
            rows={2}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>

        <label>この案は何をもとに考えましたか？（複数選択可）</label>
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

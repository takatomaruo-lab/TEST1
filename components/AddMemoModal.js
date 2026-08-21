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
  // DESIGN は過去セッションの記録。現在は思考メモに統合済みだが、
  // 既存データを選択肢から外さないため残している
  if (item.type === 'DESIGN') {
    return `思考メモ：${item.designs?.caption || '(無題)'}`;
  }
  if (item.type === 'MEMO') {
    const memo = item.memos;
    const label = (memo?.text || '').slice(0, 30);
    if (label) return `思考メモ：${label}`;
    return memo?.image_path ? '思考メモ：(画像のみ)' : '思考メモ：(空)';
  }
  return '(不明なノード)';
}

export default function AddMemoModal({
  sessionId,
  nodes,
  fragments,
  revisionTarget,
  onClose,
  onCreated,
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
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
    // 文章か画像のどちらかがあれば保存できる
    if (!text.trim() && !file) {
      setError('内容を入力するか、画像を選択してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // 画像が選ばれていればStorageにアップロードする
      let imagePath = null;
      if (file) {
        const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
        const ext = extMatch ? extMatch[0] : '';
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const path = `${sessionId}/${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from('design-images')
          .upload(path, file);
        if (uploadErr) throw uploadErr;
        const { data: pub } = supabase.storage.from('design-images').getPublicUrl(path);
        imagePath = pub.publicUrl;
      }

      const { data: node, error: nodeErr } = await supabase
        .from('nodes')
        .insert({ session_id: sessionId, type: 'MEMO' })
        .select()
        .single();
      if (nodeErr) throw nodeErr;

      const { error: memoErr } = await supabase.from('memos').insert({
        node_id: node.id,
        text: text.trim() || null,
        image_path: imagePath,
        revision_parent_id: revisionTarget ? revisionTarget.id : null,
      });
      if (memoErr) throw memoErr;

      const linkRows = [];
      for (const c of candidates) {
        const key = c.kind === 'fragment' ? `fragment:${c.id}` : `node:${c.id}`;
        if (selected[key]) {
          linkRows.push({
            source_node_id: c.kind === 'fragment' ? null : c.id,
            source_fragment_id: c.kind === 'fragment' ? c.id : null,
            target_node_id: node.id,
            link_source: 'reference',
          });
        }
      }
      if (linkRows.length > 0) {
        const { error: linkErr } = await supabase.from('links').insert(linkRows);
        if (linkErr) {
          console.error('links insert error:', linkErr);
          onCreated(node.id);
          setError(
            `思考メモ自体は保存できましたが、関連付け（つながりの線）の保存に失敗しました: ${linkErr.message}`
          );
          return;
        }
      }

      onCreated(node.id);
      onClose();
    } catch (err) {
      console.error(err);
      setError(`保存に失敗しました: ${err?.message || err}`);
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
        <h2>{revisionTarget ? '思考メモを更新' : '思考メモを追加'}</h2>

        <label>
          内容
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="気づき・違和感・判断理由など自由に"
          />
        </label>

        <label>
          画像（任意・スケッチ・図面・模型写真など）
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        <label>この考えは何をもとに生まれましたか？（任意・複数選択可）</label>
        <div className="candidate-list">
          {candidates.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
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
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function StartPage() {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [condition, setCondition] = useState('TOOL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleStart(e) {
    e.preventDefault();
    if (!label.trim()) {
      setError('参加者IDを入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: participant, error: pErr } = await supabase
        .from('participants')
        .insert({ label: label.trim(), condition })
        .select()
        .single();
      if (pErr) throw pErr;

      const { data: session, error: sErr } = await supabase
        .from('sessions')
        .insert({ participant_id: participant.id })
        .select()
        .single();
      if (sErr) throw sErr;

      router.push(`/session/${session.id}`);
    } catch (err) {
      console.error(err);
      setError('開始できませんでした。少し時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="start-page">
      <form className="card" onSubmit={handleStart}>
        <h1>設計判断記録ツール</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          参加者IDを入力してセッションを開始してください。
        </p>
        <label>
          参加者ID
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: P07"
          />
        </label>
        <label>
          利用モード
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="TOOL">TOOL（全機能あり）</option>
            <option value="CONTROL">CONTROL（AIチャットのみ）</option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? '開始中...' : 'セッションを開始'}
        </button>
      </form>
    </main>
  );
}

"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import ProcessMap from '../../../components/ProcessMap';
import AddMemoModal from '../../../components/AddMemoModal';
import NodeDetailPanel from '../../../components/NodeDetailPanel';

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.sessionId;

  const [condition, setCondition] = useState('TOOL');
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [fragments, setFragments] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);

  const [promptInput, setPromptInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingLinkSource, setPendingLinkSource] = useState(null);

  const [selectedNode, setSelectedNode] = useState(null);
  const [showMemoModal, setShowMemoModal] = useState(false);
  // 追加するメモの種別（AIメモ／思考メモ）。仕様は同じで記録種別だけが異なる
  const [memoIsAi, setMemoIsAi] = useState(false);
  // AIチャット欄の表示・非表示
  const [showChat, setShowChat] = useState(true);
  const [reviseTarget, setReviseTarget] = useState(null);

  const [loadError, setLoadError] = useState(null);
  const [memoToast, setMemoToast] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);

  const loadCondition = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*, participants(condition)')
      .eq('id', sessionId)
      .single();
    setCondition(data?.participants?.condition || 'TOOL');
  }, [sessionId]);

  const loadData = useCallback(async () => {
    const { data: nodesData, error: nodesErr } = await supabase
      .from('nodes')
      .select('*, ai_turns(*), designs!designs_node_id_fkey(*), memos!memos_node_id_fkey(*)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (nodesErr) {
      console.error('nodes fetch error:', nodesErr);
      setLoadError(nodesErr.message || 'データの取得に失敗しました');
    } else {
      setLoadError(null);
    }

    const safeNodes = nodesData || [];
    setNodes(safeNodes);

    const nodeIds = safeNodes.map((n) => n.id);
    let linksData = [];
    if (nodeIds.length > 0) {
      const { data, error } = await supabase
        .from('links')
        .select('*')
        .in('target_node_id', nodeIds)
        .is('deleted_at', null);
      if (error) console.error('links fetch error:', error);
      linksData = data || [];
    }
    setLinks(linksData);

    const aiNodeIds = safeNodes.filter((n) => n.type === 'AI').map((n) => n.id);
    let fragData = [];
    if (aiNodeIds.length > 0) {
      const { data, error } = await supabase
        .from('ai_fragments')
        .select('*')
        .in('ai_node_id', aiNodeIds);
      if (error) console.error('fragments fetch error:', error);
      fragData = data || [];
    }
    setFragments(fragData);

    const turns = safeNodes
      .filter((n) => n.type === 'AI')
      .sort((a, b) => (a.ai_turns?.sequence || 0) - (b.ai_turns?.sequence || 0));
    const hist = [];
    turns.forEach((t) => {
      hist.push({ role: 'user', text: t.ai_turns.prompt });
      hist.push({ role: 'assistant', text: t.ai_turns.response });
    });
    setChatHistory(hist);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    loadCondition();
    loadData();
  }, [sessionId, loadCondition, loadData]);

  async function handleSend() {
    const trimmed = promptInput.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      const res = await fetch('/api/ai/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          prompt: trimmed,
          history: chatHistory,
          linkSource: pendingLinkSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setPromptInput('');
      setPendingLinkSource(null);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('AIへの送信に失敗しました。もう一度お試しください。');
    } finally {
      setSending(false);
    }
  }

  async function openNodeDetail(node) {
    setSelectedNode(node);
    try {
      await supabase.from('view_events').insert({
        node_id: node.id,
        session_id: sessionId,
        opened_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
    }
  }

  function consultAI(node) {
    const preview =
      node.type === 'AI'
        ? node.ai_turns?.prompt
        : node.type === 'DESIGN'
        ? node.designs?.caption
        : node.memos?.text || '(画像のみ)';
    const label = node.type === 'AI' || node.memos?.is_ai ? 'AIメモ' : '思考メモ';
    setPromptInput(`(${label}「${(preview || '').slice(0, 30)}」について) `);
    setPendingLinkSource({ node_id: node.id });
    setSelectedNode(null);
  }

  function reviseNode(node) {
    setReviseTarget(node);
    setMemoIsAi(!!node.memos?.is_ai);
    setShowMemoModal(true);
    setSelectedNode(null);
  }

  // ノードをダブルクリックして本文を書き換えたときの保存処理。
  // AIチャット由来の記録（type='AI'）は実際のやり取りそのものなので対象外
  async function updateMemoText(nodeId, newText) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'MEMO') return;
    try {
      const { error } = await supabase
        .from('memos')
        .update({ text: newText })
        .eq('node_id', nodeId);
      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(`メモの更新に失敗しました: ${err?.message || err}`);
    }
  }

  async function saveFragment(aiNodeId, text) {
    await supabase.from('ai_fragments').insert({ ai_node_id: aiNodeId, selected_text: text });
    await loadData();
  }

  async function handleMemoCreated(newNodeId) {
    await loadData();
    setMemoToast({ nodeId: newNodeId });
  }

  function focusOnNode(nodeId) {
    setFocusRequest({ nodeId, token: Date.now() });
  }

  // メモをドラッグして動かした位置を保存する（次回読み込み時も同じ位置に表示するため）
  async function updateNodePosition(nodeId, x, y) {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, position_x: x, position_y: y } : n))
    );
    try {
      const { error } = await supabase
        .from('nodes')
        .update({ position_x: x, position_y: y })
        .eq('id', nodeId);
      if (error) console.error('position update error:', error);
    } catch (err) {
      console.error(err);
    }
  }

  // ハンドル同士をドラッグしてつないだ時の保存処理
  async function createManualLink(sourceNodeId, targetNodeId) {
    // source_node_idとtarget_node_idの組が完全一致する場合のみ重複とみなす
    // （A→BとB→Aは意味が異なる別リンクとして扱う）
    const isDuplicate = links.some(
      (l) => l.source_node_id === sourceNodeId && l.target_node_id === targetNodeId
    );
    if (isDuplicate) {
      console.log('duplicate link skipped:', sourceNodeId, targetNodeId);
      return;
    }
    try {
      const { data: linkRow, error } = await supabase
        .from('links')
        .insert({
          source_node_id: sourceNodeId,
          source_fragment_id: null,
          target_node_id: targetNodeId,
          link_source: 'manual_draw',
        })
        .select()
        .single();
      if (error) {
        console.error('manual link insert error:', error);
        return;
      }
      if (linkRow) {
        await supabase.from('link_logs').insert({ link_id: linkRow.id, action: 'CREATED' });
      }
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  // 「自動整列」ボタン：全ノードの手動位置を解除し、接続関係・作成時刻ベースの自動配置に戻す
  async function autoArrangeNodes() {
    try {
      const { error } = await supabase
        .from('nodes')
        .update({ position_x: null, position_y: null })
        .eq('session_id', sessionId);
      if (error) console.error('auto-arrange error:', error);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteLink(linkId) {
    await supabase.from('links').update({ deleted_at: new Date().toISOString() }).eq('id', linkId);
    await supabase.from('link_logs').insert({ link_id: linkId, action: 'DELETED' });
    await loadData();
  }

  const nodeMap = {};
  nodes.forEach((n) => (nodeMap[n.id] = n));

  return (
    <div className="workspace">
      {loadError && (
        <div className="error-banner">データの読み込みでエラーが発生しました: {loadError}</div>
      )}
      <div className="workspace-main">
        <div className="map-column">
          <ProcessMap
            nodes={nodes}
            links={links}
            fragments={fragments}
            onNodeClick={openNodeDetail}
            focusRequest={focusRequest}
            onNodeDragEnd={updateNodePosition}
            onManualConnect={createManualLink}
            onDeleteLink={deleteLink}
            onAutoArrange={autoArrangeNodes}
            showAddMemo={condition === 'TOOL'}
            onAddMemo={(isAi) => {
              setReviseTarget(null);
              setMemoIsAi(!!isAi);
              setShowMemoModal(true);
            }}
            onEditNodeText={updateMemoText}
            showChat={showChat}
            onToggleChat={() => setShowChat((v) => !v)}
          />
        </div>

        {showChat && (
        <div className="chat-column">
          {pendingLinkSource && (
            <div className="link-source-banner">
              <span>この送信は選択したノードにつながります</span>
              <button className="btn-secondary" onClick={() => setPendingLinkSource(null)}>
                解除
              </button>
            </div>
          )}
          <div className="chat-history">
            {nodes
              .filter((n) => n.type === 'AI')
              .map((n) => (
                <div
                  className="chat-turn"
                  key={n.id}
                  onClick={() => openNodeDetail(n)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="chat-prompt">{n.ai_turns?.prompt}</div>
                  <div className="chat-response">{n.ai_turns?.response}</div>
                </div>
              ))}
            {nodes.filter((n) => n.type === 'AI').length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>
                下の入力欄からAIに質問してみましょう。
              </p>
            )}
          </div>
          <div className="chat-input-row">
            <textarea
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="AIに質問..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button className="btn" onClick={handleSend} disabled={sending}>
              {sending ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
        )}
      </div>

      {showMemoModal && (
        <AddMemoModal
          sessionId={sessionId}
          nodes={nodes}
          fragments={fragments}
          revisionTarget={reviseTarget}
          isAi={memoIsAi}
          onClose={() => {
            setShowMemoModal(false);
            setReviseTarget(null);
            setMemoIsAi(false);
          }}
          onCreated={handleMemoCreated}
        />
      )}

      {memoToast && (
        <div className="memo-toast">
          <span>思考メモを追加しました</span>
          <button
            onClick={() => {
              focusOnNode(memoToast.nodeId);
              setMemoToast(null);
            }}
          >
            ここに移動
          </button>
          <button className="toast-close" onClick={() => setMemoToast(null)}>
            ×
          </button>
        </div>
      )}

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          links={links}
          fragments={fragments}
          nodeMap={nodeMap}
          condition={condition}
          onClose={() => setSelectedNode(null)}
          onConsultAI={consultAI}
          onRevise={reviseNode}
          onDeleteLink={deleteLink}
          onSaveFragment={saveFragment}
        />
      )}
    </div>
  );
}
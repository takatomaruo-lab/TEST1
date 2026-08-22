import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';
import { buildSystemInstruction, getMode, DEFAULT_MODE_ID } from '../../../../lib/aiModes';

const GEMINI_MODEL = 'gemini-3.5-flash';

// モードごとの思考の深さ。
// temperature / topP / topK は Gemini 3.x では公式に非推奨（デフォルト設定に
// 最適化されているため外から指定すると噛み合わない）。渡していない。
// 出力の幅や忠実さは lib/aiModes.js の system 側のルールで作る。
const MODE_THINKING = {
  reference: 'medium',
  propose: 'medium',
  organize: 'medium',
  // 批評だけは見落としやトレードオフを洗い出すため深く考えさせる
  critique: 'high',
};

// 参加者が選んだ「参照する記録」を、AIに渡す文脈ブロックに整形する
function buildContextBlock(contextItems) {
  if (!Array.isArray(contextItems) || contextItems.length === 0) return '';
  const lines = contextItems
    .map((item, i) => {
      const label = (item.label || '記録').trim();
      const text = (item.text || '').trim();
      if (!text) return `${i + 1}. ${label}：(本文なし・画像のみ)`;
      return `${i + 1}. ${label}：${text}`;
    })
    .join('\n');
  return `【参照する記録】\n${lines}\n\n`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      sessionId,
      prompt,
      history,
      mode: rawMode,
      contextItems,
      // 旧仕様との互換（単一ノードを指定して送るケース）
      linkSource,
    } = body;

    if (!sessionId || !prompt) {
      return NextResponse.json(
        { error: 'sessionId and prompt are required' },
        { status: 400 }
      );
    }

    const modeId = getMode(rawMode).id;
    const thinkingLevel = MODE_THINKING[modeId] || MODE_THINKING[DEFAULT_MODE_ID];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not set on the server' },
        { status: 500 }
      );
    }

    // 整理・批評は「参加者が選んだ記録」を主材料にするため、
    // 過去のチャット履歴は渡さず、文脈の混入を防ぐ。
    const useHistory = modeId === 'reference' || modeId === 'propose';

    const contextBlock = buildContextBlock(contextItems);
    const userText = contextBlock
      ? `${contextBlock}【今回の入力】\n${prompt}`
      : prompt;

    const contents = [
      ...(useHistory && Array.isArray(history)
        ? history.map((h) => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.text }],
          }))
        : []),
      { role: 'user', parts: [{ text: userText }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: buildSystemInstruction(modeId) }],
          },
          generationConfig: {
            maxOutputTokens: 2048,
            thinkingConfig: {
              thinkingLevel,
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return NextResponse.json(
        { error: 'AI APIの呼び出しに失敗しました' },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    const responseText =
      geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
      '(応答を取得できませんでした)';

    const { count } = await supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('type', 'AI');
    const sequence = (count || 0) + 1;

    const { data: node, error: nodeErr } = await supabase
      .from('nodes')
      .insert({ session_id: sessionId, type: 'AI' })
      .select()
      .single();
    if (nodeErr) throw nodeErr;

    // prompt には参加者が実際に打った文だけを保存する。
    // どの記録を参照したかは links 側に残るため、本文を二重に持たない。
    const { error: turnErr } = await supabase.from('ai_turns').insert({
      node_id: node.id,
      prompt,
      response: responseText,
      sequence,
      model_name: GEMINI_MODEL,
      mode: modeId,
    });
    if (turnErr) throw turnErr;

    // 参照した記録から、今回のAIメモへ有向リンクを張る
    const sources = [];
    if (Array.isArray(contextItems)) {
      contextItems.forEach((item) => {
        if (item?.node_id || item?.fragment_id) {
          sources.push({
            node_id: item.node_id || null,
            fragment_id: item.fragment_id || null,
          });
        }
      });
    }
    if (linkSource && (linkSource.node_id || linkSource.fragment_id)) {
      const dup = sources.some(
        (s) =>
          s.node_id === (linkSource.node_id || null) &&
          s.fragment_id === (linkSource.fragment_id || null)
      );
      if (!dup) {
        sources.push({
          node_id: linkSource.node_id || null,
          fragment_id: linkSource.fragment_id || null,
        });
      }
    }

    if (sources.length > 0) {
      const { data: linkRows, error: linkErr } = await supabase
        .from('links')
        .insert(
          sources.map((s) => ({
            source_node_id: s.node_id,
            source_fragment_id: s.fragment_id,
            target_node_id: node.id,
            link_source: 'consult_ai',
          }))
        )
        .select();
      if (linkErr) {
        console.error('links insert error:', linkErr);
      } else if (linkRows && linkRows.length > 0) {
        await supabase
          .from('link_logs')
          .insert(linkRows.map((l) => ({ link_id: l.id, action: 'CREATED' })));
      }
    }

    return NextResponse.json({
      nodeId: node.id,
      response: responseText,
      mode: modeId,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
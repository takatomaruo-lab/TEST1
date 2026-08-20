import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';

const GEMINI_MODEL = 'gemini-3.5-flash';

export async function POST(request) {
  try {
    const body = await request.json();
    const { sessionId, prompt, history, linkSource } = body;

    if (!sessionId || !prompt) {
      return NextResponse.json(
        { error: 'sessionId and prompt are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not set on the server' },
        { status: 500 }
      );
    }

    const contents = [
      ...(Array.isArray(history)
        ? history.map((h) => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.text }],
          }))
        : []),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({ contents }),
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

    const { error: turnErr } = await supabase.from('ai_turns').insert({
      node_id: node.id,
      prompt,
      response: responseText,
      sequence,
      model_name: GEMINI_MODEL,
    });
    if (turnErr) throw turnErr;

    if (linkSource && (linkSource.node_id || linkSource.fragment_id)) {
      const { data: linkRow, error: linkErr } = await supabase
        .from('links')
        .insert({
          source_node_id: linkSource.node_id || null,
          source_fragment_id: linkSource.fragment_id || null,
          target_node_id: node.id,
          link_source: 'consult_ai',
        })
        .select()
        .single();
      if (!linkErr && linkRow) {
        await supabase
          .from('link_logs')
          .insert({ link_id: linkRow.id, action: 'CREATED' });
      }
    }

    return NextResponse.json({ nodeId: node.id, response: responseText });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
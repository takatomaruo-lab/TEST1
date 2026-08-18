# 設計判断記録ツール（MVP実装）

指示書（design-tool-implementation-spec.md）のPhase 1機能を実装したNext.jsアプリです。
サーバーは自分で立てません。Supabase（DB・画像保存）とVercel（公開）にそのままアップロードして動かします。

## フォルダ構成

```
app/
  page.js                    参加者IDを入力してセッションを開始する最初の画面
  session/[sessionId]/page.js  メイン画面（AIチャット＋プロセスマップ）
  api/ai/turn/route.js       AI（Gemini）呼び出し用の唯一のサーバー機能
components/                  設計案追加・思考メモ追加・プロセスマップ・詳細パネル
lib/supabaseClient.js        Supabaseへの接続設定
```

## 1. 事前に済ませておくこと

- Supabaseでプロジェクトを作成し、指示書のSQLを実行済み（テーブル作成・design-imagesバケット作成）
- Supabaseの `Project URL` と `anon public` キーを控えている
- Google AI StudioでGemini APIキーを取得済み

## 2. 動かす前の設定

このフォルダの `.env.local.example` を `.env.local` という名前でコピーし、3つの値を入力してください。

```
NEXT_PUBLIC_SUPABASE_URL=（Supabaseで控えたProject URL）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（Supabaseで控えたanon public キー）
GEMINI_API_KEY=（Google AI Studioで発行したAPIキー）
```

`.env.local` はGitHubにはアップロードしません（`.gitignore` に含まれているため自動で除外されます）。

## 3. GitHubにアップロードする

事前に作成しておいた空のGitHubリポジトリに、このフォルダの中身をアップロードします。
`YOUR_USERNAME/YOUR_REPO` の部分は自分のGitHubのユーザー名とリポジトリ名に置き換えてください。

```
cd このフォルダのパス
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 4. Vercelで公開する

1. Vercelにログインし「Add New」→「Project」
2. 先ほどpushしたGitHubリポジトリを選択して「Import」
3. 「Environment Variables」の欄に、`.env.local` と同じ3つの値を1つずつ登録する
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
4. 「Deploy」を押す。数分で完了し、発行されたURL（例: `https://xxxx.vercel.app`）が参加者・研究者共通のアクセス先になる

## 5. 動作確認

1. 発行されたURLを開く
2. 参加者IDを入力し「セッションを開始」
3. 左のチャット欄からAIに質問→自動で右のプロセスマップに反映されるか確認
4. 「＋設計案」「＋思考メモ」から記録が追加できるか確認

## 補足：Geminiのモデル名について

`app/api/ai/turn/route.js` の中で `gemini-3.5-flash` というモデル名を指定しています。
Googleは時々モデル名を更新するため、もし「AI APIの呼び出しに失敗しました」というエラーが出た場合は、
https://ai.google.dev/gemini-api/docs/models で現在使えるモデル名を確認し、同ファイル内の `GEMINI_MODEL` の値を書き換えてください。

## ローカルで先に試したい場合（任意）

必須ではありませんが、Vercelにアップロードする前に自分のPCで動作確認したい場合は以下も可能です。

```
npm install
npm run dev
```

その後 http://localhost:3000 を開くと確認できます。

# 新マルチクリップボード（NEW MULTI CLIPBOARD）

よく使うプロンプト・定型文・リンクが**最初から入っている**、読み取り専用のクリップボード。
自分でクリップを作って保存するのではなく、「**探す → すぐコピーする**」ことだけに特化しています。

- PC・スマホどちらでもそのまま使えます（インストール・ログイン不要）
- ビルド不要の静的サイト（HTML / CSS / JavaScript のみ、依存ライブラリなし）
- 元データ：`multiclipboard-backup-2026-08-08.json`

## できること

| 機能 | 説明 |
| --- | --- |
| ジャンル | 8ジャンル（画像・議事録・スライド・思考・開発・生活・告知・リンク集）で切り替え |
| タグ | 20タグで横断的に絞り込み。「いずれか / すべて含む」を切り替え可能 |
| 検索 | タイトル・要約・タグ・**本文の中身**まで一致。スペース区切りでAND検索 |
| コピー | カードのボタンで全文コピー。リンク集・コピペ集は**行ごと**にコピー |
| 編集してコピー | その場で一部だけ書き換えてコピー。**保存はされません**（閉じる／リロードで元通り） |
| 入力欄ジャンプ | `【ここに入力】` などの空欄を検出して黄色く表示。「▶ 空欄へ」で順番に選択 |
| お気に入り | ★を付けると先頭に並びます |
| よく使う順 | コピーした回数・最後に使った時刻で並べ替え |
| **申請リスト** | 削除・変更・追加のお願いを溜めて、**1本のAIエージェント用プロンプト**に変換 |
| ライト／ダーク | 右上のボタンで切り替え。設定は端末に記憶されます |

### 申請リスト（削除・変更・追加）

アプリ自身は `data.js` を書き換えません。代わりに「こう直してほしい」を溜めて、
AIエージェント（Claude Code / Codex など）に渡すプロンプトを組み立てます。

| 申請 | 出し方 |
| --- | --- |
| 🗑 削除 | カード右下の `🗑`、または詳細画面いちばん下の「このクリップの削除を申請」 |
| 📝 変更 | 詳細画面で「✏️ 編集してコピー」→ 書き換え → 「📝 変更を申請」 |
| ✨ 追加 | ツールバーの「＋ 新しいクリップを追加申請」から、タイトル・ジャンル・タグ・本文を入力 |

右上の `📮`（件数バッジつき）を開くと申請リストが出ます。ここで、

- 申請ごとに**補足メモ**を書ける
- 申請を**1件ずつ取り消す**（✕）／**全部消す**
- 下に**生成済みプロンプト**が出ていて、そのままコピーできる

同じクリップに対する削除申請は押すたびにON/OFF、変更申請は最新の編集内容で上書きされます。
本文に ``` を含むクリップでも、フェンス記号を自動で長くして壊れないようにしています。

#### 生成されるプロンプトの中身

Codex・Claude Code など**複数のAIが交代で編集する**前提なので、プロンプトの先頭に
「**まず GitHub の最新版を pull してから編集する**」手順が必ず入ります。古いファイルを
元に書き換えて、他のAIの変更を消してしまうのを防ぐためです。

1. `git pull --rebase origin main` で最新を取り込む（クローンが無ければ `git clone`）
2. 依頼一覧のとおりに `new-multi-clipboard/data.js` だけを書き換える
3. `node -e "global.window={};require('./new-multi-clipboard/data.js');…"` で件数を検算
4. `git add new-multi-clipboard/data.js` → commit → **push前にもう一度 pull --rebase** → push
5. `npx vercel@latest deploy --prod --yes --scope makoto1465s-projects` でデプロイ
6. 公開URLを開いて件数を目視確認

リポジトリや公開先を変えたときは、`app.js` 冒頭の `REPO` を書き換えれば、生成されるプロンプトも追従します。

```js
var REPO = {
  url: 'https://github.com/makoto1465/blob-chain',
  clone: 'https://github.com/makoto1465/blob-chain.git',
  branch: 'main',
  dir: 'new-multi-clipboard',
  file: 'new-multi-clipboard/data.js',
  vercelScope: 'makoto1465s-projects',
  site: 'https://new-multi-clipboard.vercel.app/'
};
```

申請リストは localStorage に保存されるので、ブラウザを閉じても残ります（クリップ本文そのものは保存しません）。

### 保存されるもの / されないもの

ブラウザの localStorage に保存するのは **お気に入り・使用回数・並び順・テーマ・チュートリアル既読・申請リスト** だけです。
クリップの本文は**一切保存しません**。編集内容はメモリ上だけに置かれ、リロードすると消えます
（ただし「変更を申請」したものは、申請リストの一部として保存されます）。

### キーボード操作（PC）

| キー | 動作 |
| --- | --- |
| `/` または `Ctrl/⌘ + K` | 検索へ移動 |
| `Esc` | 詳細を閉じる／絞り込みを解除 |

## データの直し方

中身は `data.js`（`window.CLIP_DATA`）にまとまっています。手で編集して構いません。

```js
{
  id: 'img-fighter',            // 一意のID
  cat: 'image',                 // categories[].id のどれか
  title: '格ゲー風画像生成（詳細版）',
  summary: 'カードに出る1〜2行の説明',
  tags: ['画像生成', '写真'],    // tags[].id のどれか
  type: 'single',               // 'single' なら body、'collection' なら blocks
  body: '本文…',
  // blocks: [{ label: 'パーツ名', text: '本文…' }],
  note: '注意書き（任意）',
  private: true                 // 個人情報を含む印（任意）
}
```

`data.js` は元のバックアップJSONから生成しています。差し替えるときは
`categories` / `tags` / `items` の3つの整合（`cat` と `tags` が定義済みIDか）だけ守ってください。

## ローカルで動かす

静的ファイルなので、そのまま `index.html` を開くだけでも動きます。
ただし `file://` ではブラウザによってコピーが制限されるため、簡易サーバー経由を推奨します。

```bash
npx serve .
```

Node だけで済ませたい場合：

```bash
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';f.readFile(p.join(process.cwd(),u),(e,d)=>{if(e){s.statusCode=404;return s.end('not found')}s.setHeader('Content-Type',{'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}[p.extname(u)]||'application/octet-stream');s.end(d)})}).listen(4180,'127.0.0.1',()=>console.log('http://127.0.0.1:4180'))"
```

## デプロイ

公開先： **https://new-multi-clipboard.vercel.app/**
リポジトリ： https://github.com/makoto1465/blob-chain （`new-multi-clipboard/`）

```bash
npx vercel@latest deploy --prod --yes --scope makoto1465s-projects
```

`.vercel/` にプロジェクトのひも付けが入っています（gitには入れていません）。
GitHub への push では自動デプロイされないので、上のコマンドまで実行してください。

> **公開前の注意**
> 「M-CITY参謀AI システムプロンプト」には Googleドライブのフォルダ ID・カレンダー ID・メールアドレスが含まれています（アプリ内でも 🔒 マークが付きます）。
> 誰でも見られる URL で公開する場合は、`data.js` から該当項目（`id: 'think-strategist'`）を削除するか、URL を共有しない運用にしてください。

## 元データからの整理内容

- 62件 → **45件**に整理（空クリップ3件を削除、重複を統合）
- 完全に同じ内容だった重複：`3人のプロ` / `5人の専門家` / `格ゲー風画像` / `オープンチャット`
- ほぼ同じ内容だったものは 1枚のカードに**パーツとして統合**
  - `NotebookLM議事録保存` と `Codexで議事録`（違いは `@chrome` 指定と固定ソース名）
  - `自己PRスライド` の Gemini版 / NotebookLM版
  - `デジタル名刺` の2件（名刺URLが2種類あるため両方を残しています）
- バラバラだったURLは「M-CITY・ForTuna リンク集」「マッコイ／AIツール リンク集」に集約
- メモ帳に入っていた M-CITY参謀AI のシステムプロンプトもカード化

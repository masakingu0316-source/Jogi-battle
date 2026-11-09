# 定規バトル（オンライン版）

机の上で定規をはじき合う遊びを、離れた端末どうしで対戦できるようにしたWebアプリです。
部屋を作ると5文字の部屋コードと招待リンクが出て、友だちはそれを開くだけで入れます（ログイン不要）。

## できること

- 部屋の作成と、部屋コード／招待リンクでの入室（最大4人）
- モード：クイック（1対1・机1台）／標準（1対1・机2台）／乱戦（3〜4人・机4台）／チーム戦（2対2・机4台）
- 定規は各自が選ぶ（30cmプラ・15cmプラ・30cm竹・15cmステンレス）
- 最初の1周は、落ちても元の席に戻る
- 勝ち数の記録、再戦（先手は交代）、待合室に戻ってモードやメンバーを変更
- 通信が切れても、同じ端末で開き直せば同じ席に戻れる。切れた人の番は部屋主が飛ばせる

## しくみ

```
ブラウザ（public/）  ──WebSocket──  Cloudflare Worker（src/worker.js）
                                      └ 部屋ごとの Durable Object（src/room.js）
                                          └ 部屋の進行と物理計算（src/core.js）
```

- **サーバーが判定する**：はじいた向き・強さだけをサーバーに送り、サーバーが物理計算をして、定規の動き（1/30秒ごとの位置）を全員に配ります。端末ごとに計算がずれることがなく、ズルもしにくい形です。
- **物理とルールは共有**：`public/shared/physics.js` と `public/shared/rules.js` を、サーバーと画面の両方で使っています。
- **部屋の片付け**：6時間だれも使わなかった部屋は自動で削除されます。

## 公開のしかた（GitHub → Cloudflare）

必要なもの：GitHub のアカウント、Cloudflare のアカウント（無料プランで動きます）。
Cloudflare の画面の表記は変わることがあるので、近い名前のボタンを探してください。

1. **GitHub にリポジトリを作る**
   このフォルダの中身をそのまま入れます（`node_modules` は不要）。非公開リポジトリでも構いません。
2. **Cloudflare で Worker を作る**
   ダッシュボードの「Workers & Pages」→「作成」→ GitHub のリポジトリを読み込む（Import a repository）を選び、GitHub と連携して、1 のリポジトリを選びます。
3. **設定を確認してデプロイ**
   - デプロイコマンド：`npx wrangler deploy`（初期値のままでよい）
   - ビルドコマンド：空欄のままでよい
   デプロイが終わると `https://jogi-battle.<あなたのサブドメイン>.workers.dev` のようなURLで遊べます。
4. **以降の更新**
   GitHub の main ブランチに変更を入れるたびに、自動で公開し直されます。

## 手元で動かす（任意）

Node.js 18 以上が必要です。

```sh
npm install
npm run dev     # http://localhost:8787 で起動（部屋のしくみも手元で動きます）
npm test        # ルールと部屋の進行のテスト
```

## ファイル

| ファイル | 内容 |
|---|---|
| `src/worker.js` | 入口。部屋の作成（`POST /api/rooms`）と接続（`/api/rooms/<コード>/ws`）、画面の配信 |
| `src/room.js` | 1部屋＝1つの Durable Object。接続の管理と保存 |
| `src/core.js` | 部屋の進行（入退室・モード・開始・はじく・判定・再接続）。Cloudflare に依存しない |
| `public/shared/physics.js` | 物理計算（机との摩擦・定規どうしの衝突・はじく力） |
| `public/shared/rules.js` | 机の大きさ、モード、席の配置、色 |
| `public/app.js` | 画面の切り替え、通信、はじく操作、動きの再生 |
| `public/board.js` | 盤面の描画 |
| `test/core.test.js` | テスト |

## 調整したい値

- 定規の重さ・すべりやすさ：`public/shared/physics.js` の `RULERS`
- 指の強さ：同じファイルの `MAX_IMPULSE`
- 机の大きさとモード：`public/shared/rules.js`

# ShuttlePub Web

SNS メイン UI アプリの**基盤**です (PureScript + Flame の SSR / hydration、Bun BFF)。
ShuttlePub backend の生成 OpenAPI schema を契約として固定取り込みし、backend 実装を待たずに
ビルド・mock 起動できます。認証/BFF の仕様は [AUTH.md](AUTH.md) を参照してください。

## 現在の範囲 (F0)

含む: workspace / lockfile / CI 登録、OpenAPI 取込と codegen、型付き REST adapter、アプリ所有 GraphQL SDL、
mock / real 切替、SSR + hydration、Profile context の型・fixture、visual 経路への登録。

追加済み: Hydra OIDC 認証ルート、session、Emumet Bearer 読取・Profile 選択 API。

追加済み (画面レイアウト): SNS 本体の基本レイアウト。合意済み UI 仕様
(host `intents/shuttlepub/features/quick-reaction-ui/ui-spec.md` v6 の「基本レイアウト（L）」「画面ごとの補足」
「余白」「実装上の注意」と `mocks/index.html`) に従います。

| 画面 | パス | 内容 |
| ---- | ---- | ---- |
| ホーム | `/` | タイムラインタブ (ホーム / ローカル / 連合)、投稿カード。TL 上部に投稿欄は置かない (L2) |
| 投稿詳細 | `/posts/:id` | 投稿と「返信／リアクション」タブ (既定は返信)。本文クリックと投稿時刻リンクから開く (L4) |
| 設定 | `/settings` | 「Profile」節 (常用絵文字は quick-reaction-web-ui が差し込む) |
| 通知 / 検索 / ブックマーク | `/notifications` `/search` `/bookmarks` | ナビゲーション先のみ (中身は後続) |

- デスクトップ: ヘッダー 52px (右に通知・投稿用 Profile ボタン = L1)、サイドバー 200px (「投稿する」)、本文列最大 600px。
- モバイル (767px 以下): ヘッダー 48px (左のアバターで Profile ボトムシート)、下部タブ 48px
  (ホーム・検索・投稿・通知・設定 = L3)、TL は画面端まで。両方のクロームを SSR し CSS で切り替えます。
- 投稿フォーム (L2): デスクトップは上寄せモーダル (最大 520px)、モバイルは全画面。公開範囲の 4 択は Misskey に
  合わせた**仮置き (未決)**。Esc は公開範囲メニュー→フォームの順に閉じ、閉じたら開いたボタンへフォーカスを戻します。
- 未認証 (real) は Profile ボタンの代わりに `/auth/login` への「ログイン」だけを出します。
  ログイン画面そのものは認証 UI の後続変更です。

データ: タイムライン・投稿・返信・投稿作成は固定 OpenAPI に endpoint が無いため、SDL の `timeline` / `post` /
`replies` / `createPost` は**仮 (PROVISIONAL)** のアプリ所有型です (`bff/rest/posts.ts`)。mock は
`bff/rest/post-fixtures.ts` (OpenAPI 照合の対象外) を返し、real は backend を呼ばず `NOT_IMPLEMENTED` を返します。
`createPost` は mock でも `NOT_IMPLEMENTED` です (投稿を模擬しない)。返信・リポスト・その他・画像・CW・絵文字は
配置のみで `aria-disabled` です。mock の Profile は 3 件で、切替は応答を返すだけで保存しません (stateless)。

### クイックリアクション (D03, quick-reaction-web-ui)

ui-spec v6 の C (投稿カードの反応状態)・P (ピッカー)・D (投稿詳細)・S (常用絵文字の設定) を
`src/App/Extension/Reaction.purs` (表示)・`src/Client/Reaction.purs` (状態遷移)・`src/App/Reaction.purs`
(規則) で実装しています。レイアウト側は下表の関数を決まった位置で呼ぶだけです。

| 関数 | 位置 |
| ---- | ---- |
| `summary` | 投稿カードの本文とアクション行の間 (集計チップ。自分のチップは常に左端・上位 8 種 + 「+N」) |
| `actionButton` | アクション行 3 つ目の枠。反応済みの間は出さず、枠 (`.sp-react-slot`) は 32/36px を保つ。デスクトップのポップオーバー |
| `detailTabCount` / `detailPanel` | 投稿詳細の「リアクション」タブの件数と中身 (開くと「すべて」、自分を先頭に「あなた」) |
| `settingsProfileRows` | 設定 > Profile の「常用絵文字」(チップ + 「＋」、メニュー、ドラッグ、利用不可表示) |
| `overlay` | シェルの最後 (モバイルのボトムシート・常用絵文字ピッカー・チップメニュー・トースト) |

- 1 Profile・1 投稿・1 反応。ピッカーから置き換えず、自分のチップで解除してから選び直します。
- 解除は画面上で即時に反映し、DELETE は「元に戻す」の機会が終わった時点で送ります (D03 q09): トーストが
  時間切れになる・別のトーストに置き換わる・画面遷移・Profile 切替。タブを閉じる時は `pagehide` +
  `keepalive` で送ります。元に戻すと何も送りません。未送信の解除中に選び直した反応の保存が失敗した場合は、
  解除を送り直して「反応なし」に揃えます。
- トーストはホバー・タッチ・フォーカスをそれぞれ別に保持し、すべて外れてから 3 秒で消えます (注意 3)。
- 反応の PUT / DELETE は Profile×Note ごとの FIFO で、画面の世代が変わっても保持します。同じ画面の
  二重押下は無視し、Profile 往復後の新操作は旧送信の後ろに積みます。GET 開始時の write sequence が
  変わったキーや、送信中・未送信解除中のキーは応答を破棄します。常用絵文字の保存も Profile ごとに 1 件ずつで、
  削除の「元に戻す」は削除の保存が終わるまで
  押せず、その間トーストは消えません。利用不可の常用絵文字は追加し直せない (S3 が 422) ため、その削除は
  「削除しました」だけを出し「元に戻す」を出しません (S2 の例外。利用不可は「入れ替え」が主導線)。
- mutation は旧世代の応答も完了処理し、失敗時の保留解除も元の Profile 宛に送ります。画面反映だけを
  現 epoch に制限します。bfcache から戻った時 (`pageshow` の `persisted`) は「元に戻す」を終えて操作を止め、
  `pagehide` の keepalive (本文も含む) が成功/失敗するまで待ってから読み直します。解除の重送はしません。

データ: S3 契約 (`openapi/shuttlepub.json` の `quick-reaction` タグ。常用絵文字 GET/PUT、Note ごとの反応
GET/PUT/DELETE) を `bff/rest/quick-reaction.ts` で扱います。real は `SHUTTLEPUB_API_URL` の backend へ利用者の
Bearer で送り、`501` は `NOT_IMPLEMENTED`、`409` は `REVISION_CONFLICT`、`422` (`emoji_unavailable`) は
`EMOJI_UNAVAILABLE` になります (下記の一般的なエラー対応の例外)。
**実保存の backend はまだ無いため、real では常用絵文字・反応は未実装エラーとして表示されます** (完成とは表示しません)。
他の人の反応 (集計・反応者) とカスタム絵文字一覧は契約に無いため**仮 (PROVISIONAL)** の型
(`bff/rest/reactions.ts`) で、real は `NOT_IMPLEMENTED` です。投稿の `noteId` (UUID) は S3 の `note_id` です。
開発用の旧 API `POST /api/notes/{id}/reactions` は使いません (テストで検査)。

mock は S3 の振る舞いを再現する**状態を持つ** mock (`QuickReactionStore`) で、Profile ごとの常用絵文字と反応を
プロセス内に保持します。同じ Profile として動く複数のセッション (端末) は同じ状態を見ます。初期値は
`bff/rest/reaction-fixtures.ts` (Profile 1: 常用 5 件・うち 1 件利用不可、Profile 2: 未設定、Profile 3: 3 件)。
`SHUTTLEPUB_MOCK_RESET=1` を付けた mock だけ `POST /__mock/reset` で初期値に戻せます (テスト・撮影用。
visual の起動はこれを付けます。通常の mock と real にはこのルートはありません)。

キー操作は `App.Dom.keydownAction` (アプリ唯一の keydown ハンドラ) に集めています。Flame はイベントを
ルートで委譲し最も近いハンドラだけを実行するため、子要素に keydown を足すとこれが動かなくなります。
キー操作を足すときは `keydownAction` と `Client.Update` の `KeyPressed` / `escape` を拡張してください
(ピッカーのカテゴリタブは `data-tablist="picker"`)。
フォーカス中の要素を描画で取り除くと、その focusout が描画の途中で古い model のまま update を再入させます。
トーストのボタンは押した時点で blur してから取り除きます (`App.ReactionDom.blurTarget`)。

フォーカス予約はすべて `App.Dom` の共通処理を通ります。投稿に関する予約は対象投稿も保持し、次フレームの
実行時に希望先が消失/非表示なら、現在の自分のチップ→未反応のリアクションボタンの順に可視の起点を選び直します。
Esc、選択/解除/元に戻す、失敗応答、GET 復元、ピッカーの初期/幅跨ぎフォーカスも同じ処理です。
予約後の新しい操作やフォーカス移動が優先され、GET などの修復は同投稿から失われたフォーカスだけを対象にします。

## セットアップ・起動

```bash
nix develop
bun install
./scripts/dev.sh mock     # fixture のみ。他 repo・ネットワーク・backend 不要
```

| モード | 内容 |
| ------ | ---- |
| `mock` (既定) | `SHUTTLEPUB_API_MODE=mock`。contract 照合済み fixture を返す |
| `dev` | `SHUTTLEPUB_API_MODE=real`。`SHUTTLEPUB_API_URL` と [認証設定](AUTH.md) 必須 |
| `release` | 最適化ビルドのみ (サーバーは起動しない) |

## mock / real の切替

起動時の設定だけで決まり、実行中に切り替わりません。

| 変数 | 既定 | 説明 |
| ---- | ---- | ---- |
| `PORT` | `3000` | 待受ポート |
| `SHUTTLEPUB_MOCK_RESET` | なし | `1` で mock に `POST /__mock/reset` を出す (テスト・visual 用。real では無効) |
| `SHUTTLEPUB_API_MODE` | `mock` | `mock` / `real`。それ以外の値は起動エラー |
| `SHUTTLEPUB_API_URL` | なし | real で必須。mock で指定すると起動エラー (設定ミスで fixture が動くのを防ぐ) |

real では backend の応答をそのまま扱います。`501` は `NOT_IMPLEMENTED`、クイックリアクションの `409` / `422` は
上記の `REVISION_CONFLICT` / `EMOJI_UNAVAILABLE`、その他の 4xx/5xx は `UPSTREAM_ERROR`、
接続失敗は `UPSTREAM_UNAVAILABLE`、contract に反する 200 は `INVALID_UPSTREAM_RESPONSE` として GraphQL error
(`extensions.code`) になり、画面にエラーとして表示されます。**成功や mock データへ置き換えることはありません。**
real の Profile context は本人所有の Emumet 統合 Account/Profile を使用します。
未認証は `UNAUTHENTICATED`、権限不足は `FORBIDDEN`、選択済み ID が所有一覧から消えた場合は `PROFILE_UNAVAILABLE`。
空一覧は空のまま返し、プロフィールや内部 Profile ID を捏造しません。

## schema の固定 (OpenAPI)

- `openapi/shuttlepub.json`: ShuttlePub producer (`ShuttlePub/ShuttlePub` の `openapi/shuttlepub.json`) の生成物をそのまま取り込んだもの。手編集しない。
- `openapi/producer.lock.json`: producer の commit SHA と、取り込んだバイト列の SHA-256 / サイズ。

ビルドは常に repo 内のこの 2 ファイルだけを使うためオフラインで通ります。ファイルを編集したり lock と食い違うと
`bun run openapi:verify` / `bun test` / `bun run codegen` が失敗します (CI でも実行)。

更新手順 (producer commit を明示して取り込む。ここだけがネットワークまたは producer の clone を使う):

```bash
# GitHub から取得
bun run openapi:sync -- --commit <40桁 SHA>
# ローカルの ShuttlePub clone から取得 (その commit の内容。working tree は読まない)
bun run openapi:sync -- --commit <40桁 SHA> --producer-dir /path/to/ShuttlePub [--ref <branch>]
bun run openapi:sync-scenarios -- --producer-dir /path/to/ShuttlePub
bun run codegen
```

- `openapi/quick-reaction-scenarios/`: producer が S3 契約の説明として持つリクエスト/応答のシナリオ
  (`server/tests/fixtures/quick_reaction/scenarios/*.json`) を同じ commit からそのまま取り込んだもの。
  `scenarios.lock.json` が commit と各ファイルの SHA-256 を持ち、`openapi:verify` と `bun test` が照合します。
  `bff/rest/quick-reaction-scenarios.test.ts` が全ステップを OpenAPI に照合し、mock に再生して一致を確認します。

## codegen

`bun run codegen` が次を再生成します。生成物は手編集せず、コミットします。

| 入力 | 出力 | 方式 |
| ---- | ---- | ---- |
| `openapi/shuttlepub.json` (pin 検証済み) | `bff/rest/generated/shuttlepub-api.ts` | openapi-typescript |
| `bff/schema.graphql` (アプリ所有 SDL) | `src/Generated/**` | purescript-graphql-client (`scripts/sync-graphql.ts`、emumet-web と同方式) |

`bun run codegen:check` は再生成して差分があれば失敗します (CI)。`purs-tidy` が PATH に無ければ `bunx` で取得します。
SDL から消えた型の旧ファイルは自動削除せず、検出して失敗します (手で削除してください)。

## 構成

```text
Browser (PureScript + Flame, hydrate)
  → Bun BFF  /graphql (bff/schema.graphql, graphql-yoga)
      → mock: bff/rest/mock.ts (fixtures.ts、S3 は状態を持つ quick-reaction.ts)
      → real: bff/rest/real.ts (openapi-fetch / fetch + 生成型, 応答を contract で検証)
          → ShuttlePub backend REST (/api/v1/...)
```

- `bff/rest/fixtures.ts` の fixture は `bff/openapi/contract.ts` で pin した OpenAPI に照合され、schema に反すると `bun test` が失敗します。
- Profile / ProfileContext と投稿系 (`bff/rest/posts.ts`) はアプリ所有の型で、OpenAPI にはまだ endpoint が無いため fixture は OpenAPI 照合の対象外です。
- `src/App/Route.purs`: ルート (`/`、`/posts/:id`、`/settings`、`/notifications`、`/search`、`/bookmarks`、`/login`。未知のパスは共有 NotFound)。
- `src/App/View/*`: シェル (`Shell`)、投稿カード (`PostCard`)、画面 (`Pages`)、投稿フォーム (`Compose`)、ログイン画面と通知行 (`Auth`、[AUTH.md](AUTH.md))。スタイルは `src/style.css` の `sp-` クラス。

## テスト

```bash
bun test                    # config / OpenAPI pin / contract / fixture / adapter / GraphQL / S3 シナリオ再生
spago test                  # route codec・model 往復・エラー写像・時刻表示・SSR 出力・クイックリアクションの状態遷移
bun run codegen:check
bunx tsc --noEmit           # dist/server.d.ts のスタブが必要 (CI 参照)
```

SSR → hydration の mobile / desktop 確認、シェルのキーボード・フォーカス操作 (投稿フォーム・タブ・Profile 切替)、
クイックリアクション (キーボードでの反応・解除・「元に戻す」でピッカーが閉じること・トースト消滅後の DELETE・
常用絵文字の設定・2 セッションでの共有と 409)、real モード (501 / 500) の表示確認、
ログイン UI (未ログイン・期限切れ・`/login` と拒否) は visual CI 経路で実行します
(`apps/ui-catalog/visual/screens/shuttlepub-verify.ts`、画面撮影は `visual/screens/cases.ts` の `ShuttlePub-*`)。

### クイックリアクションの通信寿命

画面用の `reaction` (Profile / epoch) と通信用の `reactionWrites` は別管理です。
Profile×Note の PUT / DELETE は FIFO で送り、Profile 切替・往復・BFCache 復帰でも
未完了の送信と失敗時の後始末を失いません。再選択失敗後の解除も元 Profile の
同じキューで、後続 PUT より先に送ります。画面への応答適用だけを epoch で制限します。
同じ画面の二重押下は無視し、旧 epoch の送信中に戻ってきた画面の操作はキューへ積みます。
常用設定は Profile 単位の送信を保持し、往復時は送信完了後の最新 revision 取得まで編集を待ちます。

投稿 GET は開始時のキー別 write sequence と照合し、途中で書き込みが入ったキーを
応答時に破棄します (すでに DELETE が完了していても古い GET で復活させません)。
BFCache 復帰は同期的に操作・Undo を止め、pagehide keepalive の応答本文読み取りまで
決着してから再取得します。失敗時も DELETE を重送せず、再取得で正します。
409 の再取得が失敗しても「もう一度保存」は再取得→取得した revision で再保存に進みます。

回帰テスト: `test/Test/Reaction.purs` が上記の順序を固定し、
`bff/reaction-dom.test.js` が未完了 keepalive のまま復帰・通信失敗・同期例外を検証します。
verify の desktop/mobile も keepalive を保留したまま pageshow を発火し、早過ぎる GET と操作再開を検査します。

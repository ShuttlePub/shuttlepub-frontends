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

### クイックリアクション (D03) の差し込み口

反応状態・ピッカー・常用絵文字設定・反応者一覧は quick-reaction-web-ui が実装します。レイアウトは
`src/App/Extension/Reaction.purs` の関数を決まった位置で呼ぶだけで、中身はそのユニットが差し替えます。

| 関数 | 位置 |
| ---- | ---- |
| `summary` | 投稿カードの本文とアクション行の間 (集計チップ C1/C3/C4) |
| `actionButton` | アクション行 3 つ目の枠。枠 (`.sp-react-slot`) は空でも 32/36px を保つ。id は `reactionButtonId` |
| `detailTabCount` / `detailPanel` | 投稿詳細の「リアクション」タブの件数と中身 (D1/D3) |
| `settingsProfileRows` | 設定 > Profile の行 (S1) |
| `overlay` | シェルの最後 (ピッカーのボトムシート・トースト) |

キー操作は `App.Dom.keydownAction` (アプリ唯一の keydown ハンドラ) に集めています。Flame はイベントを
ルートで委譲し最も近いハンドラだけを実行するため、子要素に keydown を足すとこれが動かなくなります。
キー操作を足すときは `keydownAction` と `Client.Update` の `KeyPressed` / `escape` を拡張してください。

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
| `SHUTTLEPUB_API_MODE` | `mock` | `mock` / `real`。それ以外の値は起動エラー |
| `SHUTTLEPUB_API_URL` | なし | real で必須。mock で指定すると起動エラー (設定ミスで fixture が動くのを防ぐ) |

real では backend の応答をそのまま扱います。`501` は `NOT_IMPLEMENTED`、その他の 4xx/5xx は `UPSTREAM_ERROR`、
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
bun run codegen
```

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
      → mock: bff/rest/mock.ts (fixtures.ts)
      → real: bff/rest/real.ts (openapi-fetch + 生成型, 応答を contract で検証)
          → ShuttlePub backend REST (/api/v1/...)
```

- `bff/rest/fixtures.ts` の fixture は `bff/openapi/contract.ts` で pin した OpenAPI に照合され、schema に反すると `bun test` が失敗します。
- Profile / ProfileContext と投稿系 (`bff/rest/posts.ts`) はアプリ所有の型で、OpenAPI にはまだ endpoint が無いため fixture は OpenAPI 照合の対象外です。
- `src/App/Route.purs`: ルート (`/`、`/posts/:id`、`/settings`、`/notifications`、`/search`、`/bookmarks`、`/login`。未知のパスは共有 NotFound)。
- `src/App/View/*`: シェル (`Shell`)、投稿カード (`PostCard`)、画面 (`Pages`)、投稿フォーム (`Compose`)、ログイン画面と通知行 (`Auth`、[AUTH.md](AUTH.md))。スタイルは `src/style.css` の `sp-` クラス。

## テスト

```bash
bun test                    # config / OpenAPI pin / contract / fixture / adapter / GraphQL
spago test                  # route codec・model 往復・エラー写像・時刻表示・SSR 出力
bun run codegen:check
bunx tsc --noEmit           # dist/server.d.ts のスタブが必要 (CI 参照)
```

SSR → hydration の mobile / desktop 確認、シェルのキーボード・フォーカス操作 (投稿フォーム・タブ・Profile 切替)、
real モード (501 / 500) の表示確認、ログイン UI (未ログイン・期限切れ・`/login` と拒否) は visual CI 経路で実行します
(`apps/ui-catalog/visual/screens/shuttlepub-verify.ts`、画面撮影は `visual/screens/cases.ts` の `ShuttlePub-*`)。

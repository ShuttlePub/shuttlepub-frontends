# ShuttlePub Web

SNS メイン UI アプリの**基盤**です (PureScript + Flame の SSR / hydration、Bun BFF)。
ShuttlePub backend の生成 OpenAPI schema を契約として固定取り込みし、backend 実装を待たずに
ビルド・mock 起動できます。認証/BFF の仕様は [AUTH.md](AUTH.md) を参照してください。

## 現在の範囲 (F0 基盤)

含む: workspace / lockfile / CI 登録、OpenAPI 取込と codegen、型付き REST adapter、アプリ所有 GraphQL SDL、
mock / real 切替、SSR + hydration、ルーティング骨格、Profile context の型・fixture、visual 経路への登録。

追加済み: Hydra OIDC 認証ルート、session、Emumet Bearer 読取・Profile 選択 API。

含まない: タイムライン等の本格 UI、**ログイン/選択画面のレイアウト・画面遷移・デザイン**。
画面構成はユーザーとのモック合意後の別 PR で実装します。いま表示するのは基盤検証用の素のプレースホルダ
(見出しと各データ源の状態) だけで、レイアウトを決めるものではありません。

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
- Profile / ProfileContext はアプリ所有の型で、OpenAPI にはまだ endpoint が無いため fixture は OpenAPI 照合の対象外です。
- `src/App/Route.purs`: ルート骨格 (現状は `/` のみ。未知のパスは共有 NotFound)。

## テスト

```bash
bun test                    # config / OpenAPI pin / contract / fixture / adapter / GraphQL
spago test                  # route codec・model 往復・エラー写像・SSR 出力
bun run codegen:check
bunx tsc --noEmit           # dist/server.d.ts のスタブが必要 (CI 参照)
```

SSR → hydration の mobile / desktop 確認と、real モード (501 / 500) の表示確認は visual CI 経路で実行します
(`apps/ui-catalog/visual/screens/shuttlepub-verify.ts`、画面撮影は `visual/screens/cases.ts` の `ShuttlePub-*`)。

# Booskiff Drive Web

[Booskiff](https://github.com/ShuttlePub/Booskiff) の Drive UI です。PureScript + Flame による SSR / クライアントハイドレーションと、Bun BFF (Backend-for-Frontend) で構成されています。コア機能は別リポジトリの Booskiff REST API を消費します。

## セットアップ

開発ツールは Nix flake + direnv で管理しています。Nix 環境に入った後、依存関係をインストールしてください。

```bash
nix develop
bun install
```

## 開発

`./scripts/dev.sh [mock|dev|release]` で起動モードを切り替えます。省略時は `mock` です。

| モード | 用途 | 認証 | 動作 |
| ------ | ---- | ---- | ---- |
| `mock` | mock 認証での UI 開発（既定、Booskiff core が必要） | 内蔵 mock（認証のみ） | データ操作は常に `CORE_API_URL` へ接続。監視、再バンドル、開発サーバーを起動 |
| `dev` | 実サービスとの連携検証 | Hydra + Booskiff core | 監視、再バンドル、開発サーバーを起動。cookie secret は `scripts/.env.dev` に生成・永続化 |
| `release` | 本番向け成果物の作成 | Hydra + Booskiff core | 最適化ビルドのみを行い、サーバーは起動しない。`COOKIE_SECRET_BASE64` が必要 |

```bash
./scripts/dev.sh mock
./scripts/dev.sh dev
COOKIE_SECRET_BASE64="$(openssl rand -base64 32)" ./scripts/dev.sh release
```

Mock ログインのパスワードは `password` です（メールアドレスは任意）。

## ファイル画面

`/drive` はルート、`/drive/folders/<id>` はそのフォルダーの直下を表示します。
パンくずから親へ戻れ、深いフォルダーの URL を直接開くこともできます。
リスト表示は名前・サイズ・追加日時、アイコン表示はアイコンと名前だけを表示します。
表示形式を切り替えても、現在地・名前の絞り込み・並び順は維持されます。

見出し右側の「新規」から、一覧の上部に「この場所に追加」を開き、
アップロードやフォルダー作成を行います。ファイルは上部の案内から一覧までの
領域全体にドロップでき、現在表示しているフォルダーへ追加されます。

複数ファイルのアップロードは右下の転送パネルで順番に処理します。
保存先はファイルを追加した時点のフォルダーに固定されます。
送信が 100% になった後も、サーバーが保存成功を返すまでは保存処理中です。
パネルの縮小やアプリ内のフォルダー移動で転送は中断されません。
ページの再読み込み・離脱をまたぐ再開には対応していません。
通信が切れて保存結果を確認できない場合は、保存先を確認してから再送してください。

ダウンロードはブラウザーが管理します。転送パネルは要求済みの記録を表示し、
ダウンロードの完了率や保存完了は表示しません。
画面から削除できるフォルダーは空のものに限ります。

### 対応する core

この画面には、`folders.parent_id` の migration と `root` / `parent_id` /
`require_empty` に対応した Booskiff core が必要です。先に core を更新してから
Web を更新してください。既存フォルダーはルートに残り、ファイルの所属は維持されます。

## 環境変数

`auth-bun` は import 時に環境変数を読み取ります。そのため、`dev.sh` と Compose は `SESSION_COOKIE_NAME`、`OAUTH_COOKIE_NAME`、および必要な認証設定を **import より前** に設定します。個別に `bun index.ts` を起動する場合も、同じく起動前に設定してください。

| 変数 | デフォルト | 説明 |
| ---- | ---------- | ---- |
| `PORT` | `3000` | Web サーバーの待受ポート |
| `APP_ORIGIN` | `http://localhost:3000` | ブラウザから見た Web のオリジン |
| `USE_MOCK` | `true`（`false` 以外） | mock 認証を使うか。mock ログインのパスワードは `password` |
| `COOKIE_SECRET_BASE64` | mock では DEV-ONLY 固定値 | cookie 暗号化用の32バイト base64 秘密鍵。real モードでは必須 |
| `SESSION_COOKIE_NAME` | `booskiff_session` | セッション cookie 名 |
| `OAUTH_COOKIE_NAME` | `booskiff_oauth` | OAuth state cookie 名 |
| `CORE_API_URL` | `http://localhost:8080` | Booskiff core REST API の URL |
| `USE_TEST_JWT` | `false` | E2E 向けテスト JWT 発行を有効化 |
| `TEST_JWT_ISSUER` | `http://localhost:3000` | テスト JWT の issuer |
| `TEST_JWT_PRIVATE_KEY_PEM_BASE64` | なし | テスト JWT の PKCS8 秘密鍵（base64） |
| `TEST_JWT_JWKS_JSON` | なし | テスト JWT 用 JWKS JSON |
| `TEST_JWT_PUBLIC_KEY_PEM` | なし | テスト JWT 検証用公開鍵 PEM のファイルパス |
| `HYDRA_PUBLIC_URL` | `http://localhost:4444` | Hydra Public API（real モード） |
| `HYDRA_CLIENT_ID` | `booskiff-bff` | OAuth2 client ID（real モード） |
| `HYDRA_CLIENT_SECRET` | `dev-secret` | OAuth2 client secret（real モード） |
| `HYDRA_SCOPES` | `openid profile email offline_access` | 要求 OAuth2 scope（real モード） |
| `HYDRA_AUDIENCE` | `account` | 要求する token audience（real モード） |
| `SESSION_REFRESH_SKEW_SECONDS` | `60` | アクセストークン更新を始める残り秒数 |
| `OAUTH_STATE_TTL_SECONDS` | `300` | OAuth state の有効期限（秒） |

## BFF API

ブラウザは BFF を経由して認証とデータ操作を行います。Booskiff core のアクセストークン / JWT をブラウザへ露出しません。

| パス | 用途 |
| ---- | ---- |
| `/auth/*` | ログイン、ログアウト、OAuth callback、セッション操作 |
| `/api/files` | ファイル一覧・作成（アップロード、raw body のストリーミング中継）・削除。ダウンロードは presigned URL への `302` |
| `/api/folders` | フォルダー一覧・作成・更新・削除 |
| `/api/billing/status` | 課金ステータスの取得 |
| `/.well-known/jwks.json` | mock / test-JWT モードのみの JWKS 公開。`NODE_ENV=production` では常に 404 |

新しい画面は `/api/files?root=true` または `?folder_id=<id>` で現在地を指定します。
BFF は core の一覧を 200 件ずつ最後まで取得するため、50 件を超えるファイルも表示対象です。
`/api/folders` の応答には `parentId` が含まれ、`?root=true` / `?parent_id=<id>` で
直下のフォルダーを取得できます。フィルター省略時の集約一覧は旧 API 利用者向けに維持します。
フォルダー作成は `{name, parent_id}`、画面からの削除は
`DELETE /api/folders/<id>?require_empty=true` を使用します。

## テスト

```bash
bun test bff/  # bare `bun test` ではない。e2e Playwright spec を拾わないため
bun test test/Upload.test.js  # 転送キューとXHRの状態遷移
spago test
```

## E2E

実際の Booskiff core、Postgres、MinIO、Web を Playwright で通し検証します。事前に Docker（Compose v2）、Booskiff core の checkout（または `BOOSKIFF_CORE_DIR`）、および Chromium を用意してください。

```bash
cd apps/booskiff-web
bunx playwright install chromium
BOOSKIFF_CORE_DIR=/path/to/Booskiff ./scripts/e2e.sh
```

`scripts/e2e.sh` は `e2e/.env.e2e.runtime` を生成し、Compose の起動から Playwright 実行、停止までを行います。詳細は [e2e/README.md](e2e/README.md) を参照してください。

### Real OIDC E2E (Hydra + Kratos)

```bash
bun install --frozen-lockfile --ignore-scripts
BOOSKIFF_CORE_DIR=/path/to/Booskiff bash scripts/e2e-real.sh
```

`e2e/compose.e2e.real.yml` は Hydra v2.3.0、Kratos v1.3.1、各 DB の
migration、テスト identity、OAuth クライアントを生成します。認証・署名・
token exchange は実サービスで行い、login/consent bridge だけをテスト用に
用意しています。設定と seed は Emumet の `ory/`、クライアント設定は
`apps/emumet-web/scripts/register-hydra-client.ts` を移植元としています。

loopback ポートは Web 3211、consent 3212、Hydra 4444、MinIO 19000 です。
既存 mock E2E と MinIO ポートを共有するため、同時実行しないでください。
runner は競合ポートを検出すると停止し、他のスタックを削除しません。
各実行で別 Compose project とランダム秘密値を使い、終了時に volume ごと
削除します。管理 API はホストへ公開しません。全設定・seed はテスト専用です。
NixOS では `PLAYWRIGHT_CHROMIUM_PATH=$(command -v chromium)` を指定できます。

負の系は Hydra 同意拒否、state 不一致、実 token endpoint の不正 code 拒否を
検証します。署名不正等は既存 `bff/auth-oidc.test.ts` の担当です。

**検出した既存不具合と暫定措置:** [#17](https://github.com/ShuttlePub/shuttlepub-frontends/issues/17) /
[#20](https://github.com/ShuttlePub/shuttlepub-frontends/issues/20) のログイン導線は修正済みです。
ログイン成功後に BFF が `next: /auth/oauth/start?return_to=/drive` を返し、UI が
トップレベル遷移で OAuth を開始するため、E2E の `/auth/oauth/start` 明示遷移は解除済みです。
[#19](https://github.com/ShuttlePub/shuttlepub-frontends/issues/19)（認証済み `/drive` の
フルロード時の resume DOM 破損）は #21 で修正済みです。永続化は `/drive` の
再読み込み後の UI でも検証します。CI は mock/real を別 matrix job で実行します。

## 構成

```text
Browser
  → booskiff-web (Flame SSR/hydration + Bun BFF)
  → Booskiff core REST API
  → MinIO / Postgres
```

ファイルの presigned URL は BFF の `302` リダイレクトを経由します。JWT は BFF と core 間に閉じ、ブラウザには渡しません。

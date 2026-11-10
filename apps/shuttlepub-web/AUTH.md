# FA: 認証ルートと Emumet BFF

画面構成は未実装です。ログイン/選択画面はユーザーとのモック合意後の別変更とし、
この変更はルート・JSON/GraphQL API・既存 Profile context のデータ接続だけを提供します。
独自 IdP、登録 UI、Profile 作成/編集は含みません。

## real モードの必須設定

| 変数 | 内容 |
| ---- | ---- |
| `APP_ORIGIN` | 公開 origin。HTTPS 必須（loopback 開発のみ HTTP 可） |
| `SHUTTLEPUB_API_URL` | ShuttlePub backend（従来の status adapter 用） |
| `EMUMET_API_URL` | Emumet API origin |
| `HYDRA_PUBLIC_URL` | Hydra 公開 origin（authorize/token/JWKS/revoke） |
| `HYDRA_ISSUER_URL` | 任意。ID/access token の **完全一致** issuer。省略時は `HYDRA_PUBLIC_URL` の入力値。末尾 `/` の有無も一致させる |
| `KRATOS_PUBLIC_URL` | Kratos 公開 API origin（BFF から到達可能な内部 URL でも可） |
| `HYDRA_CLIENT_ID` / `HYDRA_CLIENT_SECRET` | このアプリ専用の confidential client、`client_secret_basic` |
| `SHUTTLEPUB_COOKIE_SECRET_BASE64` | このアプリ専用のランダム32 bytes（base64）。他アプリの `COOKIE_SECRET_BASE64` は継承しない |

URL は認証情報・path・query・fragment を含まない origin に限定します。
内部 API を HTTP にする場合も、信頼されたネットワークに限定してください。
Hydra client の redirect URI は厳密に `${APP_ORIGIN}/auth/callback`、
grant は `authorization_code,refresh_token`、scope は `openid profile email offline_access`、
access token audience は **`account`** を登録します。JWT access token / RS256 が必要です。

audience の根拠: Emumet `ef82462a1ac29786701f07feed12e9efe7236f30` の稼働用 `.env` /
`.env.example` は `EXPECTED_AUDIENCE=account`。
`server/src/auth.rs` の「環境変数が無い時の既定値」は `emumet` なので同一視しません。
デプロイ先でも `EXPECTED_AUDIENCE=account` を明示し、設定差異を認証成功として隠さないでください。
Emumet/IdP の設定をこのアプリが書き換えることはありません。

## フロー・session

- `GET /auth/login` / `GET /auth/oauth/start?return_to=/...` → Hydra へ302。
  code + PKCE S256、32 bytes の state/nonce を生成し、verifier と共に300秒の暗号化 pending cookie に保存。
  ログイン画面は IdP/provider に委譲します。
- `POST /auth/login` は booskiff-web 同様の **JSON のみ**の Kratos bridge
  (`identifier`, `password`)。Kratos browser flow の CSRF node を使い、成功時は
  `{ "next": "/auth/oauth/start" }` と Kratos cookie のみ返します。HTML のログイン画面は作りません。
- `GET /auth/callback`: state・期限を照合し、verifier を token endpoint に送信。
  ID token は JWKS/RS256・issuer・client audience・expiry・sub/iat・nonce・必要時 azp を検証。
  access token も RS256・issuer・`account` audience・expiry・ID token と同一 subject を検証。
  改ざんや拒否時は session を作らず固定の401を返します。
  pending state と一致した失敗応答だけが pending/session cookie を削除できます。
  未要求の callback で既存 session や別の pending flow を消す logout CSRF は許しません。
- session は共有 `auth-bun` adapter / `auth-core` の AES-GCM codec を使用。
  token は暗号化 HttpOnly cookie 内のみで、HTML・JSON・JS storage・ログへ渡しません。
  app 専用32-byte keyから HKDF-SHA256 の `shuttlepub-web/v1` + `session` / `oauth` purpose で鍵を分離。
  `Secure` な公開環境は `__Host-shuttlepub_session`（Path=/）と
  `__Secure-shuttlepub_oauth`（Path=/auth）、loopback HTTP は `shuttlepub_session` / `shuttlepub_oauth`。
  いずれも HttpOnly・SameSite=Lax・Domain なし。session cookie は browser session 限り、
  暗号文中にも24時間の絶対期限を持ちます。4096 bytes を超える cookie は成功扱いにしません。
- access token の期限60秒前から lazy refresh。新 token の署名・audience・subject も再検証します。
  refresh 失敗時は、まだ署名/期限が有効な旧 token のみ使用可能（booskiff-web と同方針）。
  期限切れ・不正 token は cookie を消して fail closed。BFF 再起動でも同じ鍵なら session は有効、
  鍵の変更は既存 session を無効にします。
- `GET /auth/session` は `{ "authenticated": true }` のみ。未認証は401。
- `POST /auth/logout` は session/pending を削除し、Hydra access/refresh revoke と Kratos logout を
  best effort で行います。IdP 障害でもローカル logout は204。GET logout は405。
  これはローカル app session の終了であり、すべての他アプリの session を一括破棄する API ではありません。

全 POST（GraphQL query も含む）は設定済み `APP_ORIGIN` との **Origin 完全一致**が必須。
欠落・`null`・異なる Origin を Referer で救済しません。GraphQL GET mutation は405。
GraphQL の CORS は無効です（同一 origin のブラウザ専用）。Yoga の既定の Origin 反射/
credentials 許可を使って、別 origin から cookie 付き GET query を読み出すことはできません。
return URL は相対 `/...` のみで、絶対 URL・`//`・backslash・encoded slash・制御文字等は `/` に戻します。
認証/GraphQL/real SSR は `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
上流のエラー本文・token・credentials はレスポンスや診断へ反射しません。

## Profile context API

```graphql
query { availableProfiles { id handle displayName } profileContext { activeProfile { id } } }
mutation { selectProfile(id: "owned-account-nanoid") { activeProfile { id handle displayName } } }
```

現行 Emumet の `GET /api/v1/accounts`（`find_by_auth_id`）は本人所有の統合 Account/Profile 一覧です。
Bearer は BFF が付与し、ブラウザの Authorization/Cookie をそのまま転送しません。
redirect を追わず、401/403/障害/不正応答を明示エラーにします。
一覧を cursor pagination で取得し、その所有一覧にある ID だけを選択できます。
direction は実装上の `next` を使用します（Emumet route annotation の `asc/desc` とは異なる）。
100件×100ページの安全上限を超える場合や cursor が循環する場合は、切り捨てず明示エラーにします。
選択は暗号化 session に保存し、**リクエストごとに所有関係を再検証**します。
複数利用者の context をプロセス全体で共有しません。

`id` は公開 **Account nanoid**、`handle` は `name`、`displayName` は `display_name`（null 時のみ `name`）。
API は内部 Profile nanoid を返さないので作りません。今後その ID や未提供属性が必要なら、
別途 upstream API 契約を追加する必要があります。空一覧は `[]`、未選択は `activeProfile: null`。
選択先の消失・他人の ID は `PROFILE_UNAVAILABLE`、moderation 情報の不備/制限対象も fail closed。
Profile の作成や一般登録は行いません。

## 検証

```bash
bun test                 # BFF の改ざん/state/PKCE/nonce/JWT/Origin/cookie/漏洩/refresh/所有関係テスト
bunx tsc --noEmit
bun run codegen:check     # SDL を変更したら bun run codegen。生成物の手編集禁止
spago build && spago test
EMUMET_CORE_DIR=/path/to/Emumet bash scripts/e2e-real.sh
```

実 E2E は `e2e/emumet-revision` の Emumet ソースを読み取り専用でビルドし、
専用 Compose project で PostgreSQL / Kratos 1.3.1 / Hydra 2.3.0 / 既存 booskiff の test-only provider /
Emumet / BFF を起動します（Docker と Playwright Chromium が必要）。
ports 3231/3232/4544 が埋まっていれば中止し、他の stack を止めません。
終了時は今回の project のみ削除します。Emumet clone や `.env` は書き換えず、
Docker image に `.env` をコピーしません。

実 login→PKCE callback→Emumet 本人一覧読取→logout と、同意拒否・state/不正code を検証します。
新しい identity の本人一覧は空です（作成/編集は範囲外）。成功した所有Profile選択・再読取は
BFF の API 契約テストで検証し、実 E2E では存在しないProfileの選択拒否を検証します。
本格 UI/SSR hydration は既存 visual CI に任せ、この E2E は BFF-only image を使用します。
CI は既存 e2e 同様、private checkout 用 `EMUMET_READ_TOKEN` 不在なら明示的に skip。
skip と実スタックでの成功を混同せず、PR に実際のローカル実行結果を記録してください。

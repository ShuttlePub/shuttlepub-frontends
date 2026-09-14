# Visual diff CI

`check.yml` の `UI catalog visual comparison` が JSON manifest の全ストーリーを
色 × 形状テーマごとに Playwright Chromium で撮影します (現在 13 × 4 = 52 枚)。
1280×900、deviceScaleFactor=1、en-US、UTC、dark、reduced-motion を固定し、
フォント読み込み・表示を待ち、アニメーションとキャレットを無効化します。
各 `#story-*` 要素だけを撮影し、アプリ固有 View は含めません。

PR の base SHA と merge commit を**同一ジョブ・同一 Chromium**でビルド/撮影します。
両方の manifest を個別に読むため、ストーリーの追加・削除も検出します。
R2 の保存済み基準画像には依存せず、期限切れや初回実行による偽の「全件追加」を避けます。
main push は自身と比較します。カタログがビルドされていない、PNG が空、ページエラー、
HTTP エラーの場合は失敗します。比較の許容差はゼロです。

## チェックと公開の扱い

- 差分なし: 緑 check。差分あり: 比較処理成功なら緑 check (見た目の承認は PR レビュー)。
  差分は changed/new/deleted に分類し、コメントに before/after/diff を直接埋め込みます。
- `Check` 完了後の `catalog-visual-publish.yml` は default branch のコードと依存のみを実行。
  PR 成果物からは PNG のみ取り込み、レポートを再生成します。PR の HTML/JS/結果 JSON は実行・信用しません。
- R2 Secrets は公開ステップだけに渡します。fork PR は撮影・比較のみで公開しません。
- `UI_CATALOG_R2_ENABLED != true` なら公開ジョブは明示的に skip。
  必須設定が欠けた場合、R2 アップロード失敗、期限ルール不在の場合は公開ジョブが失敗します。
- 古い実行が新しい PR コメントを上書きしないよう、投稿直前に head SHA を確認します。
- **初回導入 PR では `workflow_run` が main にまだ存在しないため自動公開されません。**
  マージ後に設定を有効化し、同一 repo の検証用 PR で公開を確認してください。
  この PR の作成作業ではマージ・バケット発行を行いません。

## GitHub の設定

Repository Secrets:

| 名前 | 内容 |
| --- | --- |
| `UI_CATALOG_R2_ACCESS_KEY_ID` | R2 S3 API access key |
| `UI_CATALOG_R2_SECRET_ACCESS_KEY` | R2 S3 API secret key |

Repository Variables:

| 名前 | 内容 |
| --- | --- |
| `UI_CATALOG_R2_ENABLED` | セットアップ完了後に `true` |
| `UI_CATALOG_R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `UI_CATALOG_R2_BUCKET` | カタログ専用バケット名 |
| `UI_CATALOG_R2_PUBLIC_URL` | 認証なしで GET 可能な公開 HTTPS origin。パスなし。例 `https://visual.example.com` |

GitHub Actions の `pull-requests: write` を許可してください。専用 PAT/GitHub App は不要です。
R2 token は専用バケットのオブジェクト読み書きと GetBucketLifecycleConfiguration が必要です。
R2 の権限体系で lifecycle 読み取りに Admin Read が必要な場合、その権限も付与してください。
R2 credential の作成・運用承認はリポジトリ外で行います。

公開カスタムドメインは GitHub の画像プロキシから認証なしでアクセスできる必要があります。
Cloudflare Access / WAF challenge を適用しないでください。専用 origin とし、cookie や秘密情報は置かないこと。
PNG は `image/png`、HTML は `text/html`、プラグインが `Content-Encoding: gzip` を設定します。
`enableACL: false` / `region: auto` / `forcePathStyle: true` で R2 S3 API を利用します。
`ui-catalog/run-<run-id>-<attempt>/` は不変 URL とし、再実行時のキャッシュ混同を避けます。

## ライフサイクル (運用者が一度設定)

`lifecycle.json` は `ui-catalog/` のオブジェクトを30日後に削除し、未完了 multipart を1日で破棄します。
**専用バケット**で、S3 管理用 credentials を環境変数に入れて次を実行します。
既存バケットで `put-bucket-lifecycle-configuration` を使うと全ルールが置換されるため、
既存ルールがある場合は JSON にマージしてから適用してください。

```bash
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
aws s3api put-bucket-lifecycle-configuration --region auto \
  --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET" \
  --lifecycle-configuration file://visual/lifecycle.json
aws s3api get-bucket-lifecycle-configuration --region auto \
  --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET"
```

公開スクリプトも毎回期限ルールを確認してからアップロードします。オブジェクトに TTL メタデータを
付ける方式ではなく、prefix に対するバケットルールが適用されます。削除は非同期のため30日ぴったりを
保証しません。コメントにも保存期間を記載し、期限切れ後は画像/レポートが閲覧できなくなります。

## ローカル検証 (R2 不要)

repo root で `bun install --frozen-lockfile`、`nix develop` を実行後:

```bash
cd apps/ui-catalog
bash visual/build.sh
PORT=3220 bun index.ts # 別端末で起動
bunx --no-install playwright install chromium
CAPTURE_DIR=.visual/expected bun visual/capture.ts
# ここで必要なら共有 token/style を変更し、build.sh を再実行する
CAPTURE_DIR=.visual/actual bun visual/capture.ts
bun visual/compare.ts
LOCAL_STORE=.visual/local-store VISUAL_KEY=local-1 VISUAL_REVISION=abcdef1 \
  R2_PUBLIC_URL=https://visual.example.com bun visual/publish.ts
bun test
bunx --no-install tsc --noEmit -p visual/tsconfig.json
```

NixOS では `PLAYWRIGHT_CHROMIUM_PATH=$(command -v chromium)` を撮影時に指定できます。
Tailwind の native module が `libstdc++.so.6` を見つけられない場合は、ビルド時に
`LD_LIBRARY_PATH="$(nix eval --raw nixpkgs#stdenv.cc.cc.lib.outPath)/lib"` を指定してください。
CI はこの override を使わず、固定した Playwright に対応する Chromium を使います。
`CATALOG_URL` / `CAPTURE_DIR` / `VISUAL_DIR` でサーバーと出力ディレクトリを変更できます。
生成物は `.visual/` 以下で gitignore 対象。ローカル公開は同じキー構造でファイルをコピーし、
`.visual/comment.md` を生成します。公開 URL は例示用なのでローカルコピーからは直接閲覧してください。
`bun test` は実 reg-suit の同一/変更/追加/削除検出・ローカル保存と、実 S3 plugin の HTTP 送信
(ローカル HTTP サーバー、gzip/Content-Type/ACL 無効) を検証します。実 R2 や GitHub コメント API の
認証成功を代替するテストではありません。

## reg-notify-github-plugin 検証

0.14.5 の [通知実装](https://github.com/reg-viz/reg-suit/blob/5c09c8eb1e356d7e8145e5850e6de17b2b25a5a0/packages/reg-notify-github-plugin/src/github-notifier-plugin.ts)
は reportUrl と件数を通知 API に渡す方式で、各差分 PNG の Markdown 埋め込みを生成しません。
そのため採用せず、reg-suit-core 0.14.5 / reg-publish-s3-plugin 0.14.4 と自前コメント生成を組み合わせます。
レポート ZIP のダウンロードをレビューの前提にしません (Actions artifact はジョブ間の内部転送のみ)。

参考: [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)、
[S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)。

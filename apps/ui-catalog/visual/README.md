# Frontend visual diff CI

main 向け PR のブランチと main を同じジョブ・同じ Chromium で撮影し、
変更前 (main) / 変更後 (branch) / 差分を PR コメントに直接添付します。
R2 や公開画像バケットは不要です。

## 撮影対象

- UI catalog: 各 revision の JSON manifest にある全ストーリーを色 × 形状テーマで撮影。
  現在 13 × 4 = 52 枚。各 `#story-*` 要素を切り出し、追加・削除も検出します。
- Booskiff / Emumet: `visual/screens/cases.ts` の代表画面・状態を desktop / mobile で撮影。
  実際の SSR とクライアントハイドレーションを使用します。
  Emumet は組み込み mock、Booskiff は撮影専用の固定 REST fixture を使用し、
  backend checkout、Docker、本番認証情報には依存しません。

アプリ画面は current の共通ドライバーで両 revision を撮影します。
撮影 case を追加したときも main の画面と比較できます。
case の削除は比較対象からの除外になるため、画面廃止の表示を確認したい場合は case を残してください。
全画面を自動発見する仕組みではなく、レビュー対象の状態を明示的に登録します。

viewport、deviceScaleFactor=1、en-US、UTC、dark、reduced-motion を固定し、
フォントと表示完了を待ち、アニメーションとキャレットを無効化します。
画面撮影の時刻・データ・外部画像も固定します。
HTTP / ページエラー、空の撮影、期待する表示に到達しない場合は失敗します。

## 実行と投稿

`frontend-visual.yml` は main 向け PR と main push の frontend 変更時に実行します。
撮影開始時に解決した main SHA と PR event の `head.sha` (ブランチそのもの) を比較します。
両 SHA はビルド前に記録し、投稿側で形式・run head・現在の main を検証します。
PR 作成時の歴史的な `base.sha` には依存しません。
main push は自身と比較します。保存済み基準画像や merge commit に依存しません。

差分があっても撮影・比較成功なら check は成功です。見た目の承認は PR レビューで行います。
changed / new / deleted / passed を集計し、変更・追加・削除の画像だけを添付します。
差分なしでも結果をコメントします。

`frontend-visual-publish.yml` は比較成功後の `workflow_run` で動作し、
default branch のコードと依存だけを使用します。
画像成果物は安全な名前の PNG のみ受け入れ、枚数・サイズ・解像度を制限し、
デコード・再エンコードした画像からレポートを再生成します。
PR の HTML / JS / 比較結果 JSON は実行・信用しません。
revision evidence JSON は最大4KiBの固定スキーマとして読み、GitHub API の SHA と照合します。
撮影ジョブに投稿用 Secret は渡しません。

投稿直前・投稿中に open / main 向け / same-repository PR と head / base SHA を確認します。
古い revision の投稿を防ぎます。最新の全コメントを投稿できてから、
同じ投稿者の専用 marker がある古いレポートだけを削除します。
`--edit-last` で無関係なコメントを上書きしません。
50ファイルの添付上限を超えるレポートは複数コメントに分割します。

fork PR は Secret なしで撮影・比較まで実行し、添付しません。
PNG と HTML report の Actions artifact は7日間保持します。
GitHub 添付には旧 R2 の30日期限はありません。

## 一度だけ必要な設定

Repository Secret **`VISUAL_DIFF_GH_TOKEN`** を登録してください:
[Actions Secrets](https://github.com/ShuttlePub/shuttlepub-frontends/settings/secrets/actions)。

`gh --attach` は OAuth token / classic PAT / fine-grained PAT に対応します。
Actions 標準の `GITHUB_TOKEN` (GitHub App installation token) には対応しません。
対象 repository へ push できるアカウントの PAT を使用してください。
fine-grained PAT は対象 repository に限定し、Contents / Pull requests を read/write に設定します。
組織承認や SSO が必要な場合は有効化してください。専用 bot アカウントを推奨します。
トークンをソース・画像 fixture・チャットに記載しないでください。

Secret 未設定・期限切れ・権限不足・アップロード失敗は投稿ジョブを失敗させます。
画像比較自体は Secret なしでも実行できます。
CI の gh は **2.101.0** の release artifact を SHA-256 検証付きで固定しています。

**初回導入 PR では、投稿 workflow と信頼するスクリプトが main に存在しないため
自動添付はまだ動きません。** マージと Secret 設定後、frontend 変更を含む
同一 repository の PR で投稿まで確認してください。

参考:
[添付の公式説明](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)、
[gh pr comment](https://cli.github.com/manual/gh_pr_comment)、
[対応 token / 権限の実装](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client.go)。

## 対象の追加

コンポーネントは `manifest.ts` / `src/App/Catalog.purs` と対応テストへストーリーを追加します。
アプリ画面は `visual/screens/cases.ts` に安定した case 名・route・操作・表示待機を追加します。
必要な fixture は `visual/screens/` に置き、秘密情報・本番データを使わないでください。
[screens/README.md](screens/README.md) も参照してください。
共有 token / style の変更も、登録済みの全 case を比較して検出します。

## ローカル検証

repo root で `bun install --frozen-lockfile`、`nix develop` を実行後:

```bash
cd apps/ui-catalog
bun test
bunx --no-install tsc --noEmit -p visual/tsconfig.json
bash visual/build.sh
bash visual/build.sh ../booskiff-web
bash visual/build.sh ../emumet-web
FRONTEND_ROOT="$(git rev-parse --show-toplevel)" CAPTURE_DIR=.visual/actual bun visual/screens/capture.ts
```

NixOS では撮影時に `PLAYWRIGHT_CHROMIUM_PATH=$(command -v chromium)` を指定できます。
main を別ディレクトリへ checkout・ビルドし、同じドライバーで `FRONTEND_ROOT` を main、
`CAPTURE_DIR` を `.visual/expected` にして撮影します。
カタログはサーバーを起動して `CATALOG_URL` / `CAPTURE_DIR` を指定し
`bun visual/capture.ts` を実行します。
両側の撮影後 `bun visual/compare.ts` を実行して `.visual/report/index.html` を確認します。

投稿用 env は `GH_REPO`、`PR_NUMBER`、`VISUAL_REVISION`、
`VISUAL_BASE_REVISION` (CI は `VISUAL_REVISIONS_FILE` の検証済み base を使用)、`VISUAL_RUN_ID`、`VISUAL_RUN_ATTEMPT`、
`VISUAL_DIR` (default `.visual`) と `GH_TOKEN` です。
`bun visual/github-publish.ts` は実際に投稿するので、通常はテストの fake gh を使用してください。

旧 `visual/publish.ts` / `lifecycle.json` は任意の R2 / LOCAL_STORE 用として残しています。
自動投稿からは呼ばず、`UI_CATALOG_R2_*` の設定も不要です。

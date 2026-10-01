# ShuttlePub Frontends

ShuttlePub のフロントエンドを管理する Bun Workspaces モノレポです。

## Structure

- `apps/emumet-web/`: Emumet Web フロントエンド (PureScript + Flame SSR / Bun BFF)
- `apps/booskiff-web/`: Booskiff Drive Web フロントエンド (PureScript + Flame SSR / Bun BFF)
- `apps/ui-catalog/`: 共有 UI / デザイントークンのカタログ (PureScript + Flame SSR / Bun サーバー)
- `packages/design-tokens/`: 共有デザイントークン
- `packages/styles/`: 共有スタイル
- `packages/ui/`: 共有 UI
- `packages/auth-core/`: 共有認証コア
- `packages/auth-bun/`: Bun 向け認証

## Setup

```bash
bun install
```

アプリ固有の開発手順は [apps/emumet-web/README.md](apps/emumet-web/README.md) と [apps/booskiff-web/README.md](apps/booskiff-web/README.md) を参照してください。

PR では共有コンポーネントと両アプリの代表画面を main と比較し、変更前・変更後・差分の画像を自動添付します。
撮影対象の追加方法と一度だけ必要な Secret 設定は [ビジュアル差分 CI](apps/ui-catalog/visual/README.md) を参照してください。

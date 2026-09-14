# UI Catalog

packages/ui の共有コンポーネント (Layout / Link / NotFound / Theme shell primitives) と
design-tokens (色・radius・shadow) のショーケースです。PureScript + Flame による
SSR / クライアントハイドレーションと Bun サーバーで構成され、BFF / バックエンドには
依存しません (fixture/static のみ)。

テーマ切替 (Catppuccin Mocha / Tokyo Night × rounded / sharp) はナビゲーションバーの
ボタンから行います。`data-color` / `data-shape` 属性方式で、選択は localStorage に
保存されます (packages/design-tokens/theme.js と同じ仕組み)。

## セットアップ

```bash
nix develop
bun install
```

## 開発

```bash
./scripts/dev.sh          # watch + 開発サーバー (http://localhost:3000)
./scripts/dev.sh release  # 最適化プロダクションビルド (dist/ のみ、サーバーは起動しない)
```

## JSON manifest

ブラウザなしでカタログ内容を列挙できる agent 向けマニフェストを配信します:

```bash
curl -s http://localhost:3000/manifest.json
```

コンポーネント名・ストーリー/状態・直接 URL (`/component/layout#story-navbar` 形式) を
含みます。データのソースは `manifest.ts` (Bun 側) と `src/App/Catalog.purs`
(PureScript 側) の2か所で、両者は `manifest.test.ts` と `test/Test/Main.purs` が
同じ URL リストに固定しているため、乖離すると CI で検出されます。

## テスト

```bash
bun test    # manifest.test.ts
spago test  # route codec / model round-trip / catalog URL 一覧
```

## 構成

ビジュアル差分 CI・R2 設定・ローカル検証は [visual/README.md](visual/README.md) を参照してください。

```text
Browser
  → ui-catalog (Flame SSR/hydration + Bun server, static/fixture のみ)
  → packages/ui, packages/design-tokens, packages/styles (workspace 参照)
```

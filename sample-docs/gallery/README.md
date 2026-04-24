# Gallery — Album View デモ素材

DocView の Album View (F1) 動作確認用のサンプル画像フォルダ。

## 構成

- 直下: 16 枚 (SVG 14 + PNG 2)
  - `01-sunrise.svg` 〜 `12-crimson.svg`: グラデーション 12 色 × 4 形状バリエーション
  - `pattern-dots.svg`, `pattern-stripes.svg`: パターン系
  - `gradient.png`, `checker.png`: ラスタ画像
- `nested/`: recursive デモ用 5 枚 (SVG 4 + PNG 1)

合計: 直下 16 / 再帰 21 枚。

## 確認方法

```bash
node server.mjs sample-docs
# ブラウザで http://localhost:PORT/#album=gallery
# recursive トグルで nested/ の画像も含めた 21 枚表示
```

ファイルツリーで `gallery/` ディレクトリの右側に Album ボタン (画像数付き) が表示されることも確認できる。

## 再生成

```bash
node sample-docs/gallery/generate.mjs
```

画像は純正 Node.js のみで生成 (外部依存なし)。`generate.mjs` 内の `palette` / `variants` / `names` を変更して増減可能。

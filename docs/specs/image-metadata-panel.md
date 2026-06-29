# 画像ファイルの詳細メタデータ表示 — Spec

## Metadata
- **slug**: image-metadata-panel
- **title**: 画像ファイルの詳細メタデータ表示
- **status**: locked
- **owner**: simota
- **build-path decision**: apex（自律的な一括実装。L3 AC を検証契約とする）

## L0 — Vision
- **問題**: DocView で画像を開いても画像本体とキャプションしか見えず、寸法・撮影情報・形式詳細・由来（AI生成か）が分からない。確認には別ツールが必要。
- **対象 (who)**: ローカルのドキュメント/画像を閲覧する DocView ユーザー。
- **Job-to-be-done**: 画像を開いたまま詳細メタデータを把握し、「何の画像か（撮影 or AI生成、いつ、何で、どんな形式か）」を即座に判断する。
- **成功の定義**: 画像表示時に画像横の情報パネルで、基本+寸法 / EXIF / 色・形式詳細 / GPS（地図リンク）/ AI生成インジケータを、取得できた範囲で構造化表示できる。

## Reuse / Constraint findings (Lens)
- `src/main.ts` `renderImage()` が `<img>`+キャプション描画、`initImageZoom`。`IMAGE_EXT` = png/jpg/jpeg/gif/svg/webp/bmp/ico。
- `src/album-viewer.ts` がグリッド+Lightbox。`AlbumImage` は `size`/`mtime`/`ext` を保持。
- `server.mjs` `/api/file/meta` は `{size, mtime, ext, isDirectory, lines?}` を返すが画像の寸法・EXIF 無し。`/api/file` が画像バイトを MIME 付きで配信。
- 画像処理系ライブラリ未導入。寸法はクライアント `naturalWidth/Height` 可、EXIF/色空間/ビット深度はバイナリ解析が必要。
- 制約: Vanilla TS SPA + 素の `node:http`、フレームワーク無し。軽量 EXIF ライブラリ追加可。パストラバーサル防止・CSP・CORS localhost 限定。
- AI生成判定はヒューリスティック指標（PNG tEXt/iTXt の SD `parameters`・ComfyUI `workflow`、XMP/EXIF `Software`、C2PA）であり 100% 断定不可。

## Scope
- **in**: 表示（読み取り）専用のメタデータ閲覧。**served ディレクトリ内のローカル画像ファイル**（`/api/file?path=` で開く単一画像ビュー）を対象。
- **out**: メタデータの編集・除去・一括エクスポート。リモート URL 画像・ドラッグ&ドロップした File 画像へのサーバ抽出メタデータ（`/api/image/meta` は `path=` ベースのため対象外。これらは従来どおり画像本体のみ表示）。album/Lightbox/グリッドへの展開。埋め込み地図 iframe。

## L1 — Requirements
### Functional
- **FR-1**: `GET /api/image/meta?path=` で構造化メタデータ JSON を返す。`safePath` でパストラバーサル防止。`path` 欠落=400 / アクセス拒否=403 / 不在=404 / 非画像拡張子=415。
- **FR-2**: レスポンスは固定スキーマ `{ path, basic, dimensions, exif, color, gps, ai, raw }`。取得不可フィールドは null。部分欠落でも常に 200（best-effort）。
- **FR-3**: 単一画像ビュー表示時、情報パネルのトグル UI を提供。
- **FR-4**: パネルは basic+dimensions / EXIF / color・format / GPS / AI provenance / Raw の各セクションを折りたたみ表示。
- **FR-5**: basic+dimensions = size(人間可読) / mtime / 形式(ext+mime) / 幅×高さ / アスペクト比 / メガピクセル。全対応形式で寸法を出す。
- **FR-6**: EXIF = Make / Model / LensModel / ISO / ExposureTime / FNumber / FocalLength / DateTimeOriginal / Orientation（JPEG/TIFF/HEIC）。
- **FR-7**: color・format = bit depth / color space / ICC プロファイル有無・名称 / アルファ有無 / 圧縮方式。
- **FR-8**: GPS = 10進座標表示 + クリックで OpenStreetMap を新規タブで開く外部リンク。GPS 無しは「該当なし」。
- **FR-9**: AI provenance = (a) PNG tEXt/iTXt の SD `parameters`・ComfyUI `workflow`/`prompt`、(b) XMP/EXIF `Software`、(c) **C2PA マニフェストのフル検証**（署名妥当性 + 発行者 + アサーション要約）。指標を「AI生成の可能性」としてラベル付き表示（断定しない）。
  - **`isLikelyAiGenerated` の定義（曖昧性除去）**: 次のいずれかが真のとき `true`: ① PNG に SD/ComfyUI 生成パラメータが存在、② `Software`/`claimGenerator` が既知 AI ツール名リスト（例: Stable Diffusion / Midjourney / DALL·E / ComfyUI / NovelAI）に一致、③ C2PA アサーションの `c2pa.actions` の `digitalSourceType` が `trainedAlgorithmicMedia`。**C2PA マニフェストの存在自体は AI を意味しない**（実カメラの Content Credentials もあるため）— ③ の条件を満たす場合のみ AI 指標とする。
- **FR-10**: Raw 全タグ表（既定折りたたみ、キー/値一覧）。
- **FR-11**: 取得不可項目・非対応形式は graceful 表示（「該当なし/メタデータなし」）。パネルが空でも画像表示は壊れない。
- **FR-12 (Should)**: 各値/セクションのコピー機能。
- **FR-13 (Could)**: パネル開閉状態を localStorage 永続化。

### Non-functional
- **NFR-1**: 抽出は全て best-effort try-catch。解析失敗で 500 やフロントクラッシュを起こさない（200 + 欠落）。
- **NFR-2**: 大画像でも全バイト読みを避け、ヘッダ範囲読み（exifr の chunked read）で抽出。
- **NFR-3**: 既存セキュリティ非回帰（safePath / CSP / CORS localhost）。GPS 外部リンクは明示クリック時のみ外部送信。埋め込み iframe 追加なし。
- **NFR-4**: 既存 `renderImage` / `initImageZoom` / album-viewer を非回帰。
- **NFR-5**: `c2pa-node` のビルド不可/無効時もサーバ起動・画像表示・他メタ取得が継続（C2PA 部分のみ縮退）。

## L2 — Detail
### API (Gateway)
- `GET /api/image/meta?path=<relpath>`
- `200 application/json` — 下記スキーマ。`Cache-Control: max-age=5`（既存画像配信と同様）。
- `400` path 欠落 / `403` アクセス拒否（safePath 失敗・served 外・symlink 越え）/ `404` 不在 / `415` 非画像拡張子。
- 実装場所: `server.mjs`（既存 `/api/file/meta` ハンドラ近傍）。抽出は exifr（EXIF/color/dimensions/XMP）+ 軽量 PNG チャンクリーダー（SD/ComfyUI text）+ `c2pa-node`（C2PA 検証）。

### Data model (Schema) — レスポンス JSON
```jsonc
{
  "path": "string",
  "basic":      { "size": 0, "sizeHuman": "1.2 MB", "mtime": "ISO8601", "ext": ".jpg", "mime": "image/jpeg" },
  "dimensions": { "width": 0, "height": 0, "aspectRatio": "16:9", "megapixels": 0 } | null,
  "exif":       { "make":"", "model":"", "lensModel":"", "iso":0, "exposureTime":"1/250", "fNumber":0, "focalLength":0, "dateTimeOriginal":"ISO8601", "orientation":1 } | null,
  "color":      { "bitDepth":8, "colorSpace":"sRGB", "iccProfile":"Display P3", "hasAlpha":true, "compression":"DEFLATE" } | null,
  "gps":        { "lat":0.0, "lon":0.0, "mapUrl":"https://www.openstreetmap.org/?mlat=..&mlon=.." } | null,
  "ai": {
    "isLikelyAiGenerated": false,
    "indicators": [ { "source":"png-text|xmp|exif-software|c2pa", "label":"", "detail":"" } ],
    "c2pa": { "verified": false, "issuer":"", "claimGenerator":"", "assertions":[""] }
  } | null,
  "raw": { "TagName": "value" }
}
```

### Front-end
- 新モジュール `src/image-meta-panel.ts`（描画 + フェッチ + セクション折りたたみ）。`src/main.ts` の `renderImage` 分岐から呼ぶ。スタイルは `src/style.css`。DOMPurify でユーザー由来文字列（prompt 等）をサニタイズ。

## L3 — Acceptance Criteria
- **AC-1** (FR-1): JPEG パスで `/api/image/meta` が 200+JSON。served ディレクトリ外パスは 403。
- **AC-2** (FR-1): 不在=404 / `path` 欠落=400 / 非画像拡張子=415。
- **AC-3** (FR-2,NFR-1): EXIF 無し PNG でも 200、`exif=null`、他フィールドは取得分を含む（部分欠落で error にしない）。
- **AC-4** (FR-3,FR-4): 画像表示時にパネルのトグル UI が存在し、開閉でき、各セクションが折りたたみ表示される。
- **AC-5** (FR-5): ラスタ形式（PNG/JPEG/GIF/WebP/BMP）で 幅×高さ・アスペクト比・メガピクセルが表示。**SVG は intrinsic な `width`/`height` 属性または `viewBox` から幅×高さ・アスペクト比を表示し、メガピクセルは「N/A」**（ベクタのため）。
- **AC-6** (FR-6): EXIF 付き JPEG で Make/Model/ISO/ExposureTime/FNumber/FocalLength/DateTimeOriginal/Orientation のうち存在する項目が表示。
- **AC-7** (FR-7): PNG で bit depth・color type、JPEG で color space・ICC 有無が表示。
- **AC-8** (FR-8): GPS 付き画像で 10進座標が表示され、地図リンクが正しい lat/lon の OSM URL を `target=_blank rel=noopener` で開く。GPS 無しは「該当なし」。
- **AC-9** (FR-9a): SD 生成 PNG（`parameters` tEXt）で prompt/params が表示され AI 生成インジケータが立つ。
- **AC-10** (FR-9c): C2PA マニフェスト付き画像で検証結果（verified 真偽 + issuer/claimGenerator）が表示。無効署名/改ざんで verified=false。
- **AC-11** (FR-9): AI 指標が無い通常写真では「AI生成の指標なし」と表示し、断定的な"非AI"表現をしない。**C2PA Content Credentials のみ（`digitalSourceType` ≠ `trainedAlgorithmicMedia`）の実カメラ写真では `isLikelyAiGenerated=false`** とし、C2PA 情報は表示しつつ AI 指標は立てない。
- **AC-12** (FR-10): Raw 全タグ表が既定折りたたみで、展開するとキー/値一覧が見える。
- **AC-13** (FR-11): EXIF 非対応形式（BMP/ICO）でパネルが空にならず「メタデータなし」を表示、画像本体は正常表示。
- **AC-14** (NFR-1): 破損/切り詰め画像でも `/api/image/meta` は 200（部分 or 空）を返し、フロントは例外を投げない。
- **AC-15** (NFR-3): served 外・symlink 越えパスは 403（safePath 非回帰）。GPS 地図リンクをクリックするまで外部へリクエストが飛ばない。
- **AC-16** (NFR-4): 既存の画像ズーム・album/Lightbox が回帰しない（既存 E2E グリーン）。
- **AC-17** (NFR-5): `c2pa-node` 無効/ビルド不可でもサーバ起動・画像表示・他メタ取得が成功し、C2PA 部分のみ「検証不可」を表示。
- **AC-18** (FR-12,Should): コピー操作で当該値がクリップボードに入る。
- **AC-19** (FR-13,Could): パネル開閉状態がリロード後も保持される。
- **AC-20** (NFR-2,human-verify): 大画像（>20MB）でも全バイト読み込みなしで抽出が完了する（exifr の chunked read 使用をコードレビューで担保）。

## Considered but rejected
- **D（Lightbox/グリッドへの横展開）** → LOCK 後の拡張に保留（まず単一ビューで価値検証）。
- **軽量 AI 検出のみ（C2PA 暗号検証なし）** → ユーザー判断でフル C2PA 検証を採用。
- **GPS 座標のみ / 埋め込み地図 iframe** → プライバシー × CSP のバランスで外部リンク方式を採用。
- **クライアント側抽出** → バンドル肥大・バイト再取得のため、サーバ側 `/api/image/meta` を採用。

## Open Questions / Deferred Decisions
- **OQ-1 (C2PA フォールバック)**: `c2pa-node` のネイティブビルド失敗時の縮退仕様を実装時に確定（候補: C2PA/JUMBF の存在検出のみに縮退 / C2PA セクション無効化）。NFR-5/AC-17 で「継続すること」は確定済み、縮退の具体形は実装で詰める。
- **OQ-2 (テストフィクスチャ)**: AC-6/8/9/10 の検証には固定画像が必要（EXIF付きJPEG・GPS付き・SD生成PNG・C2PA有効/改ざん）。フィクスチャ調達/生成方法を実装時に用意（CAI 公開テスト画像等）。
- **OQ-3 (パネル開閉トグル UI 配置)**: 既存ツールバー/ボタン群との整合を実装時にデザイン確定。
- **OQ-4 (SD/ComfyUI params 表示量)**: 全文表示 vs 要約+展開。既定は折りたたみ + 展開で全文、を推奨だが UX 微調整は実装時。

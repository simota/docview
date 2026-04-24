# RFC: DocView 大量画像閲覧機能提案 (Album Mode)

**日付:** 2026-04-24
**著者:** Spark (via Nexus)
**ステータス:** Draft / 提案
**対象:** DocView (`docview` / `mdv`) v0.x
**関連コード:** `src/main.ts` (`IMAGE_EXT`, `renderImage`, `initImageZoom`), `server.mjs` (MIME handling), `src/chunked-table.ts` (仮想スクロールパターン参考), `src/filetree.ts`

---

## 1. 背景と問題意識

DocView は Markdown ドキュメントビューアとして設計されているが、ローカルディレクトリを開くツールという性質上、画像ファイルも頻繁に混在する。現状は 1 枚ずつファイルツリーをクリックして開く方式しかなく、以下の「大量画像閲覧」ユースケースで著しく体験が劣化する。

### 1.1 ターゲットユースケース (Personas & JTBD)

| # | ペルソナ | JTBD (Progress sought) | 現状の workaround |
|---|----------|-----------------------|-------------------|
| U1 | **デザイナー カオリ** — UI モック担当。Figma 書き出し後の PNG 100 枚を「差分確認したい」 | 「バージョン違いの UI を素早く切り替え比較し、採用案を固めたい」 | Finder の Cover Flow、Preview.app で 1 枚ずつ開く |
| U2 | **フロントエンド エンジニア タカシ** — スクリーンショット集 (regression tests) を見る | 「30 枚の PNG diff を 1 分でざっと確認し、怪しいものだけ拡大したい」 | VSCode の Image Preview をタブで並べる |
| U3 | **技術ライター ミキ** — 記事用素材アセット整理 | 「dir 内の画像を一覧し、Markdown に貼りたいものを素早く特定」 | ファイル名頼りの勘、または `ls` + `open` |
| U4 | **写真家 アマチュア** — 旅行写真アーカイブを見返す | 「昔の旅の写真を一覧サムネイルでぱらぱら眺めたい」 | macOS Photos への import |

### 1.2 ペインポイントの抽出

1. **一覧性ゼロ** — 1 枚ずつ表示のため「このフォルダに何があるか」把握に数分〜数十分かかる。
2. **遅延読み込みなし** — 仮に `<img>` 一括生成しても 500 枚の PNG を同時読みで DOM/メモリが破綻する。
3. **比較の負荷** — 既存 split view は 2 枚同時のみ。3 枚以上の並置や「前後パラ送り」ができない。
4. **メタ情報欠如** — ファイルサイズ/解像度/撮影日時/Alt テキストが見えない。
5. **ナビゲーションが遅い** — filetree からクリック→renderImage→ズーム初期化、のフローはキーボード操作に最適化されていない。

### 1.3 非消費 (Non-consumption) 仮説

多くのユーザーは「DocView で画像を見る」こと自体を諦め、OS 標準のファインダや専用ビューアへ離脱している。この離脱はアナリティクスでは観測できないが、「Markdown の隣に画像フォルダがある」という典型的ドキュメントレポで DocView が完結しないことが機会損失になっている。

---

## 2. 設計原則

1. **Markdown ビューアを主、画像ビューアを副** に据える。画像モードは「オン・デマンドで呼び出す追加体験」で、既存ドキュメント操作を一切阻害しない。
2. **既存アーキテクチャに整合** — Vanilla TS + ES Modules、新規ビューアは `src/*-viewer.ts` 命名規則を踏襲、フレームワークは入れない。
3. **セキュリティ原則を維持** — 新 API もすべて path-traversal チェック (`server.mjs` 共通関数) を通し、localhost-only、CSP 準拠。
4. **ローカルファースト** — 外部 SaaS/クラウドに依存しない。サムネイル生成もローカル実装 (`sharp` or OffscreenCanvas) で完結。
5. **SSE ライブリロード整合** — ディレクトリに画像が追加/削除されたら album ビューに即反映。
6. **段階的ロールアウト** — P0 (MVP) だけで「使える」、P1/P2 は体験を磨く増分。

---

## 3. 機能提案一覧 (12 機能)

凡例 — 優先度: **P0** = MVP 必須、**P1** = v1.1 相当、**P2** = nice-to-have。工数: **S** = 1-3 日、**M** = 1 週間、**L** = 2 週間+。

---

### P0: MVP リリース (画像を「大量に見る」最低限)

#### F1. Album View — ディレクトリ内画像のグリッド一覧

**概要:** ディレクトリ選択時、そのディレクトリ直下 (+ 任意で再帰) の画像ファイルをサムネイルグリッドで一覧表示するモード。filetree でディレクトリをクリック or URL `#album=path` で起動。

**ユーザー価値:** U1/U2/U3/U4 全員に刺さる。「開けばすぐ見える」一覧性ゼロ問題を根本解決。

**優先度/工数:** P0 / M (1 週間)

**技術概要:**
- 新規 `src/album-viewer.ts` を追加 (既存 `csv-viewer.ts` / `jsonl-viewer.ts` と同ファイル規模 ~300 行想定)。
- 新 API `GET /api/album?path=<dir>&recursive=<0|1>` — `server.mjs` に追加。既存 `/api/tree` のロジックを流用し、画像拡張子のみフィルタ + basic stats (size, mtime) を返す。
- グリッドは CSS Grid (`repeat(auto-fill, minmax(160px, 1fr))`)、サムネ自体は F2 の API を `<img loading="lazy" decoding="async">` で参照。
- キーボード操作: 矢印キーで選択移動、Enter で単一表示、Esc で一覧に戻る。

**セキュリティ/パフォーマンス:**
- ディレクトリ列挙は既存 `safeResolve()` で path-traversal 防止。
- 画像ファイル数に `?limit=2000` デフォルト上限を設け、超過時は warning バナー表示 + paginate。
- `IntersectionObserver` で可視領域のみサムネ要求 (F2 と組み合わせて帯域削減)。

**既存機能との統合点:**
- `filetree.ts`: ディレクトリの「画像数 ≥ N」で自動的に album モードアイコンを表示 (opt-in UI)。
- `tabs.ts`: album ビューをタブに保持 (既存の複数タブ機構を流用)。
- `url-bar.ts`: `#album=path` ルーティングを `main.ts` のルーターに追加。
- `theme.ts`: light/dark/paper/whiteboard/handwritten 各テーマでグリッド背景を調整。

---

#### F2. Thumbnail API — サーバーサイドサムネイル生成

**概要:** `GET /api/thumbnail?path=<file>&w=320` で画像のサムネイル (WebP) を返す API。ディスクキャッシュ付き。

**ユーザー価値:** F1 を現実的な速度で動かす基盤。8MP JPEG 500 枚を原寸ロードすると 4GB メモリ爆発、サムネなら < 50MB。

**優先度/工数:** P0 / M (1 週間)

**技術概要:**
- 新規エンドポイントを `server.mjs` に追加。`sharp` (既に Node エコシステム標準、ネイティブ依存あり) を `optionalDependencies` 扱いで導入。fallback として `sharp` 未インストール時は原画像を返す (警告ログ)。
- キャッシュ: `<served-root>/.docview-cache/thumb-<hash>-w320.webp` (hash = file path + mtime + width)。`.docview-cache/` は `/api/tree` で自動除外。
- サポートサイズは `w=160|320|640` の 3 段階のみ (RICE Impact 優先、無限バリエーションは YAGNI)。

**セキュリティ/パフォーマンス:**
- path-traversal を共通関数で。`w` パラメータはホワイトリスト整数のみ許容。
- SVG はサムネ化対象外 (原 SVG をそのまま返す)。GIF はアニメ破棄せず最初のフレームのみ縮小。
- レスポンス `Cache-Control: public, max-age=3600` + `ETag: <mtime-hash>`。
- 同時生成を限定 (`p-limit(4)` 相当を内製、依存増やさない)。

**既存機能との統合点:**
- F1 Album View のメイン画像ソース。
- F4 スライドショーのプリロードソース。
- Markdown 本文の `<img>` にも (optional で) サムネ URL を適用する余地あり (P2 以降)。

---

#### F3. Lightbox & Keyboard Navigation — 全画面画像閲覧 + キーボード前後送り

**概要:** Album グリッドでクリック/Enter → 全画面 Lightbox 表示。矢印キーで前/次画像に移動、数字キーで zoom 倍率、Esc で閉じる。

**ユーザー価値:** U2/U4 の「30-500 枚をぱらぱら送って確認」ユースケースの核心。マウス往復なしで全確認可能。

**優先度/工数:** P0 / S (2-3 日)

**技術概要:**
- `album-viewer.ts` に同梱 (別モジュール化するほどの規模でない)。
- 既存 `initImageZoom()` を `initLightboxZoom()` として拡張流用。
- 前後ナビゲーションは `albumList` 配列のインデックスで管理。隣接 ±1 枚を `<link rel="preload">` で先読み。

**セキュリティ/パフォーマンス:**
- 先読みは ±1 枚のみ (原画像)。過度なプリロードはメモリ圧迫のため禁止。
- Esc / Back (brower history) 両方で閉じる。

**既存機能との統合点:**
- `help-modal.ts`: キーバインド一覧に album モードのショートカット (←/→/Esc/+/−/0) を追記。
- `find-bar.ts` のように overlay UI パターンを踏襲。

---

#### F4. Album への Live Reload 統合

**概要:** SSE (`/api/watch`) が拾ったファイル変更イベントを album view にも反映。新規画像追加で即グリッドに現れる、削除で即消える、リネームで順序更新。

**ユーザー価値:** U2 のスクリーンショット取りつつ即確認するフロー、U1 のビルド成果物監視フローで決定的。

**優先度/工数:** P0 / S (1-2 日)

**技術概要:**
- 既存 SSE ハンドラ (`main.ts` 内の watch subscriber) に album 専用コールバックを追加。
- diff 適用は単純な「全件再取得」で十分 (通常ディレクトリサイズなら < 200ms)。大規模ディレクトリ用に debouce 500ms。

**セキュリティ/パフォーマンス:**
- 既存 SSE と同じ localhost-only ポリシー継承。新規攻撃面なし。

**既存機能との統合点:**
- `main.ts` の SSE リスナ。既存 Markdown リロード路線と分岐。

---

### P1: v1.1 相当 (比較と検索で生産性を上げる)

#### F5. Multi-Select & Compare Grid — 複数枚の並置比較

**概要:** album グリッドで Shift/Cmd クリック複数選択 → 「Compare」ボタンで 2-4 枚の同時表示 (2x1 / 2x2 レイアウト)。既存 split view の拡張版。

**ユーザー価値:** U1 (デザイナー) の「A 案/B 案/C 案」比較、U2 の regression snapshot 比較。現状の split view (2 枚固定) の延長。

**優先度/工数:** P1 / M (1 週間)

**技術概要:**
- 既存 `main.ts:1448` の split view ロジックを一般化して 2-4 ペイン対応に拡張。
- 同期ズーム/同期パンのトグル (「全ペインで同じ座標を拡大」)。
- レイアウトは CSS Grid で動的切替 (`grid-template-columns`)。

**セキュリティ/パフォーマンス:**
- 同時 4 枚までの制限 (DOM/GPU 予算)。
- ズーム同期は `requestAnimationFrame` で throttling。

**既存機能との統合点:**
- `main.ts` の split view 関数を `renderCompare(paths: string[])` に refactor。
- `tabs.ts`: 比較セッションを 1 タブとして保持。

---

#### F6. Image Metadata Sidebar — EXIF / 解像度 / 容量表示

**概要:** Lightbox/単一表示時に右サイドバーにファイル名、ピクセルサイズ、容量、mtime、EXIF (撮影日、機種、GPS、ISO、焦点距離、露出) を表示。

**ユーザー価値:** U4 (写真家) 必須。U1/U2 でも「この PNG いつの？」「解像度何 px？」の即時把握。

**優先度/工数:** P1 / M (1 週間)

**技術概要:**
- 新 API `GET /api/image-meta?path=<file>` — `server.mjs` に追加。
- EXIF パース: `exifr` ライブラリ (pure JS、~30KB、zero deps)。JPEG/HEIC/TIFF 対応。PNG は `sharp` or ヘッダ直読みで width/height。
- GPS は opt-in 表示 (プライバシー考慮、デフォルト OFF + トグル)。

**セキュリティ/パフォーマンス:**
- EXIF パース失敗はサイレント (壊れた画像もよくある)。
- GPS 情報はデフォルト非表示。設定で明示的 opt-in。path-traversal は共通関数で。

**既存機能との統合点:**
- F3 Lightbox の右ペインに組み込み。
- F1 Album グリッドの hover tooltip にも簡易版 (w×h のみ) を表示。

---

#### F7. Album Sort & Filter — 並び順/フィルタ

**概要:** album view に sort ドロップダウン (name / mtime / size / dimensions) と filter (拡張子絞り込み、ファイル名部分一致、mtime 範囲) を追加。

**ユーザー価値:** U3 (ライター) の「先週撮ったスクショだけ出したい」、U4 の「大きい写真だけ見たい」。

**優先度/工数:** P1 / S (2-3 日)

**技術概要:**
- 全部クライアント側処理 (F2 の API レスポンスに必要 stats を含めるだけで追加 API 不要)。
- フィルタ UI は `toc.ts` の検索入力パターンを踏襲。

**セキュリティ/パフォーマンス:**
- ディレクトリが 10k 枚超の場合、フィルタはクライアント側で現実的 (stats は軽量)。

**既存機能との統合点:**
- `search.ts` と無関係 (全文検索ではなくメタ情報のみ)。別 UI に切る。
- `url-bar.ts`: ソート条件を URL ハッシュに埋め込み (`#album=path&sort=mtime`)。

---

#### F8. Search by Alt / Filename in Album — album 専用検索

**概要:** album 内で `/` キー → インクリメンタルサーチ。ファイル名、Markdown 内 alt テキスト、image-meta の EXIF タグ (機種、場所名) を対象。

**ユーザー価値:** U3 の「あの画像どこだっけ」問題。U2 の「failed-checkout-*」絞り込み。

**優先度/工数:** P1 / S (2-3 日)

**技術概要:**
- クライアント側 fuzzy search (既存の `search.ts` のロジックを再利用可能ならする、不足なら小規模 `fuse.js`-like 自作)。
- Alt テキスト収集: 同ディレクトリの `*.md` を一度走査し `![alt](path)` を抽出してマップ化 (`/api/search` で "images" モードを追加する手もある)。

**セキュリティ/パフォーマンス:**
- Alt 収集は初回のみ、以降 SSE で invalidate。
- 既存 `/api/search` を `type=image-alt` オプションで拡張するのが筋 (新 API 作るほどでない)。

**既存機能との統合点:**
- `find-bar.ts` の vim-like パターンを踏襲 (キーバインドも同じ `/`)。
- `search.ts` の全文検索とは別レイヤ。

---

### P2: nice-to-have (体験を尖らせる)

#### F9. Slideshow Mode — 自動めくりスライドショー

**概要:** album から「Slideshow」開始 → 指定秒数で自動送り、手動 pause、フルスクリーン、BGM なし。

**ユーザー価値:** U4 (写真家) の旅行アーカイブ閲覧、U1 のデザインレビュー発表。

**優先度/工数:** P2 / S (2-3 日)

**技術概要:**
- F3 Lightbox の拡張。`setInterval` ベース、interval は設定で 2/5/10 秒。
- Fullscreen API (`element.requestFullscreen()`) を使用。
- ローカルストレージに再生設定を保存 (`theme.ts` の localStorage パターン踏襲)。

**セキュリティ/パフォーマンス:**
- タブ非アクティブ時は自動 pause (Page Visibility API)。CPU/バッテリ配慮。

**既存機能との統合点:**
- `help-modal.ts` にスライドショーキー (Space = pause/resume) を追記。

---

#### F10. Markdown への画像挿入アシスト (Copy as Markdown)

**概要:** album で画像を選択 → 右クリック or `y` キーで `![alt](relative/path.png)` をクリップボードにコピー。相対パスは現在開いている Markdown からの相対で計算。

**ユーザー価値:** U3 (ライター) の核心ワークフロー。現状は手でパスを打つしかない。

**優先度/工数:** P2 / S (1-2 日)

**技術概要:**
- Clipboard API (`navigator.clipboard.writeText`) のみ、サーバー追加不要。
- 相対パス計算は既存の Markdown 相対画像解決 (`main.ts:708` 付近) のロジックを逆方向に使う。

**セキュリティ/パフォーマンス:**
- localhost では Clipboard API は通常許可されるが、失敗時はテキスト選択ダイアログで fallback。

**既存機能との統合点:**
- `tabs.ts`: 現在アクティブな Markdown タブを参照して基点決定。

---

#### F11. Contact Sheet Export — 印刷/PDF 化

**概要:** album を「連番付き N×M グリッド」1 枚の PDF / PNG として書き出す。`window.print()` ベースでも可。

**ユーザー価値:** U1 のデザインレビュー用配布、U4 のフォトアルバム印刷。

**優先度/工数:** P2 / M (1 週間)

**技術概要:**
- CSS Paged Media (`@page`, `@media print`) でブラウザ印刷機能を活用。PDF はブラウザの「PDF として保存」。
- 別途 `html2canvas` 等の重依存は避け、Paged Media のみで実現。

**セキュリティ/パフォーマンス:**
- 大規模画像は print 時にも F2 サムネ URL を使用 (メモリ配慮)。

**既存機能との統合点:**
- album UI に「Print / Export」ボタン追加。他モジュールへの影響なし。

---

#### F12. Video Preview (Light) — 短尺動画インライン再生

**概要:** `.mp4 .webm .mov` を album グリッドに含め、サムネは先頭フレーム、クリックでインライン再生。

**ユーザー価値:** U2 の Playwright `test-results/` に `.webm` トレースが混在するケース (実際 DocView 直下にもある)、U4 のスマホ動画混在。

**優先度/工数:** P2 / M (1 週間+、sharp 代替の ffmpeg 依存検討)

**技術概要:**
- 対象拡張子を新 `VIDEO_EXT` で定義。MIME は `server.mjs` に追加。
- サムネは ffmpeg 必要。`sharp` 同様 optional 扱い、未インストール時は汎用 film アイコン fallback。
- Range リクエスト対応 (`Accept-Ranges: bytes`) をサーバーに追加 (HTTP range は `server.mjs` で 20 行程度)。

**セキュリティ/パフォーマンス:**
- ffmpeg 外部プロセスは spawn 時に引数をハードコード (ユーザー入力はファイルパスのみ、シェル経由しない)。
- Range 対応は大容量動画の再生シーク必須条件。

**既存機能との統合点:**
- `IMAGE_EXT` と並行して `VIDEO_EXT` を `main.ts` に追加、type detection を `'media'` に統合する選択肢もあり (破壊的変更注意)。

---

## 4. 優先度サマリ (Impact-Effort / RICE 相当)

| ID | 機能 | 優先度 | 工数 | Impact (1-3) | Confidence | 分類 |
|----|------|--------|------|--------------|-----------|------|
| F1 | Album View | P0 | M | 3 | 70% | Big Win |
| F2 | Thumbnail API | P0 | M | 3 (F1 の基盤) | 80% | Big Win |
| F3 | Lightbox + Keyboard | P0 | S | 2 | 70% | Quick Win |
| F4 | Album Live Reload | P0 | S | 2 | 60% | Quick Win |
| F5 | Multi-Select Compare | P1 | M | 2 | 50% | Big Bet |
| F6 | Metadata Sidebar | P1 | M | 2 | 60% | Fill-In |
| F7 | Sort & Filter | P1 | S | 2 | 70% | Quick Win |
| F8 | Album Search | P1 | S | 2 | 50% | Quick Win |
| F9 | Slideshow | P2 | S | 1 | 50% | Fill-In |
| F10 | Copy as Markdown | P2 | S | 2 | 60% | Quick Win |
| F11 | Contact Sheet Export | P2 | M | 1 | 40% | Time Sink 注意 |
| F12 | Video Preview | P2 | M | 2 | 40% | Big Bet |

Impact 分布: 3 = 2件 (F1,F2)、2 = 8件、1 = 2件。`≤20% が Impact=3` ガイドラインに準拠。

---

## 5. 推奨 MVP セット

**リリース名:** DocView Album Mode v1 (仮)

**含む機能:** F1 + F2 + F3 + F4 (P0 の 4 件すべて)

**合計工数見積:** M + M + S + S ≈ **2.5〜3 週間** (1 名、design/testing/docs 含む、30% バッファ込み)

**このセットで実現される価値:**
- ディレクトリを開くと画像が**即グリッド表示される** (F1)
- 500 枚あっても**メモリ爆発しない** (F2 のサムネイル + lazy load)
- キーボードで**ぱらぱら全確認**できる (F3)
- スクショ取りつつ**裏で即反映**される (F4)

**MVP で意図的に外すもの:**
- EXIF, Sort/Filter, Compare, Slideshow, PDF, Video → これらは「あると嬉しい」。なくても「開ける・見える・めくれる」が達成できるため最小集合として排除。

**MVP の仮説 (testable hypothesis):**
> 画像ファイルを含むディレクトリを開いたユーザーのうち **>40% が Album モードに遷移**し、そのうち **>60% が複数画像をブラウズ** (Lightbox で 3 枚以上送る) する。

**Fail Condition (kill criteria):**
> リリース 30 日後に
> - Album モード到達率 < **15%** (そもそも発見されていない → UI 再設計要)、または
> - Lightbox で 1 枚だけ見て離脱する率 > **80%** (サムネ一覧時点で満足 or 使い物にならない)
>
> のどちらかで、**P1 以降の投資を凍結し、MVP を再検証フェーズに戻す**。

**検証方法:**
- ローカル CLI ゆえ本番 analytics は設置しない (プライバシー原則)。
- 代わりに: 社内/OSS コントリビュータ 5-10 名での 2 週間 dogfooding + 構造化インタビュー (15 分/人)。
- 観察項目: 最初の 1 分で album モードに辿り着いたか、キーボード操作を発見したか、画像数 100+ のディレクトリでフリーズしないか。

---

## 6. 実装順序の推奨ロードマップ

```
Week 1:  F2 (Thumbnail API) — 基盤なので最初
          └─ sharp 導入可否の最終判断もここで
Week 2:  F1 (Album View) + F3 (Lightbox) — UI の本体
Week 3:  F4 (Live Reload) + MVP 社内 dogfooding 開始
─── MVP ship ───
Week 4-5: F7 (Sort/Filter) + F8 (Search) — 軽量で効く
Week 6-7: F6 (Metadata) + F5 (Multi-Compare)
─── v1.1 ship ───
Backlog:  F9, F10, F11, F12 — ユーザー要望を見てから着手
```

---

## 7. オープンな設計決定 (要議論)

1. **`sharp` 依存の是非** — ネイティブビルド必須。`optionalDependencies` で逃げる設計だが、未インストール時の体験をどこまで妥協するか。代替案: OffscreenCanvas でブラウザ側サムネ生成 (原画像は 1 度ロード必要、メモリ懸念)。
2. **`.docview-cache/` の場所** — served root 直下か、OS 標準キャッシュ (`~/Library/Caches/docview/` 等) か。後者なら symlink 不要だが発見性低下。推奨: 後者 + `--cache-dir` CLI フラグで上書き可能に。
3. **Video 対応の範囲** — F12 を P2 でなく「未定」に落とす選択肢。DocView は「ドキュメントビューア」であり、動画は別ツールという思想も成り立つ。
4. **再帰探索のデフォルト** — album は直下のみ / 再帰どちらをデフォルトに？ 推奨: 直下のみ (驚き最小原則)、UI トグルで再帰 ON。

---

## 8. リスクと対策

| リスク | 対策 |
|--------|------|
| 画像処理で Markdown ビューアが重くなる | album コードは **動的 import** (`await import('./album-viewer.js')`)。画像ディレクトリに行かない限り bundle に影響しない。 |
| sharp のネイティブビルド失敗 | `optionalDependencies` + 起動時に `warn` ログ、fallback 動作継続 |
| 巨大ディレクトリ (10k+ 画像) のフリーズ | F1 で `?limit=2000` デフォルト + `IntersectionObserver` + F2 のディスクキャッシュで 3 段防御 |
| EXIF GPS の偶発的漏洩 | F6 で GPS デフォルト非表示、明示 opt-in |
| MVP スコープクリープ (F5 や F6 を P0 に繰り上げ誘惑) | 本 RFC の MVP セクションを契約として扱う。F5/F6 は必ず v1.1 に回す |

---

## 9. Handoff 先

- **Scribe** — 本 RFC を正式仕様 (PRD/SRS) に変換する。
- **Builder** — F2 (Thumbnail API) から実装開始。server.mjs 変更が先行。
- **Artisan** — F1 / F3 の UI 実装 (Vanilla TS、既存 `*-viewer.ts` パターン踏襲)。
- **Experiment** — MVP の dogfooding 計画設計、fail-condition のトラッキング方法。

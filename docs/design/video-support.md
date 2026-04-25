# 動画ファイル対応 設計書

> Status: Draft / Author: Scribe / Target: docview (`mdv`)
> 既存の画像アルバム機能 (`src/album-viewer.ts`, `loadAlbumView`) を出発点とした動画一覧・詳細表示の追加設計。

---

## 1. 目的とスコープ

### 目的

ローカルディレクトリにある動画ファイルを、画像と同等の体験で **一覧 (タイル) 表示** および **詳細 (Lightbox 拡張) 再生** できるようにする。docview の「ローカル素材を素早くブラウズする」というユースケースを動画にも広げる。

### できるようになること

- ファイルツリーで動画拡張子を専用アイコンで識別できる。
- ディレクトリ単位で動画 (および画像) のタイル一覧を開ける。
- タイルにはサムネイル・再生時間バッジ・動画識別オーバーレイが表示される。
- タイルをクリックすると Lightbox 上で `<video controls>` で再生でき、キーボードで前後ナビ・シーク・再生制御ができる。
- 大容量動画でも HTTP Range request (206 Partial Content) によりシーク可能。
- ファイル監視 (Chokidar/SSE) によって動画が追加/削除されると一覧が更新される。

### やらないこと (本スコープ外)

- HLS / DASH などのストリーミング形式 (`.m3u8`, `.mpd`) のサポート。
- サーバ側でのトランスコード (ffmpeg 連携) およびサーバ生成サムネイル画像の永続化。
- 動画編集・トリム・字幕編集・チャプタ編集。
- 動画専用の検索 (全文検索対象は従来どおりテキストファイルのみ)。
- iOS Safari 等のモバイル特有挙動の最適化 (docview はローカルブラウズ前提)。

---

## 2. 対応フォーマット

ブラウザの `HTMLVideoElement` がデコーダを持つ拡張子のみ対象とする。

| 拡張子 | MIME タイプ           | 主要ブラウザ互換 (Chrome / Edge / Firefox / Safari) | 備考 |
|--------|------------------------|-----------------------------------------------------|------|
| `.mp4` | `video/mp4`            | OK / OK / OK / OK                                   | H.264+AAC が事実上の互換最大公約数 |
| `.m4v` | `video/mp4`            | OK / OK / OK / OK                                   | mp4 と同等扱い |
| `.webm`| `video/webm`           | OK / OK / OK / 部分的                               | Safari は VP8/VP9 のみ。AV1 は要 macOS 13+ |
| `.ogv` | `video/ogg`            | OK / OK / OK / NG                                   | Theora。Safari は再生不可 |
| `.mov` | `video/quicktime`      | 部分的 / 部分的 / NG / OK                           | **コンテナ内コーデック次第。H.264 mov は Chrome でも再生可だが ProRes/HEVC mov は不可。後述の警告 UI を出す** |
| `.mkv` | `video/x-matroska`     | NG / NG / NG / NG                                   | **対象外** (タイル一覧でも非表示) |

### `.mov` に関する補足

`.mov` は QuickTime コンテナで、内部コーデックが多岐 (H.264, HEVC, ProRes, …) にわたる。サーバはコンテナの判別までしかできず、再生可否は実ブラウザに依存する。設計上は次の方針を取る。

- 拡張子としては「サポート対象」に含め、一覧・Lightbox では他フォーマットと同じく扱う。
- `<video>` 要素の `error` イベントで `MEDIA_ERR_SRC_NOT_SUPPORTED` を捕まえたら、Lightbox 内に「このブラウザでは再生できないコーデックの可能性があります (`.mov` は QuickTime コンテナ依存)」というインライン通知を出す。
- タイル段階では一律「動画」として描画する (ロード前に判定不能のため)。

### 拡張子定義の置き場所

- フロントエンド: `src/main.ts` に `VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov'])` を追加。
- サーバ: `server.mjs` に `VIDEO_EXTENSIONS` Set と `VIDEO_MIME` マップを追加 (`IMAGE_EXTENSIONS` と並列)。
- ファイルツリー: `src/filetree.ts` の `EXT_MAP` に動画拡張子を `category: 'video'` で登録。

---

## 3. アーキテクチャ判断: アルバム機能との統合 vs 別機能化

### 比較

| 観点 | A: アルバムを「ギャラリー」に一般化して画像+動画を 1 機能で扱う | B: 動画専用ビュー (`loadVideoGallery`) を新設 |
|------|-----------------------------------------------------------------|----------------------------------------------|
| タイル/グリッド (`renderAlbum`) 再利用 | 高: タイル要素単位で画像/動画を分岐 | 低: 同等のタイル/CSS をほぼ複製 |
| 複数選択・ZIP DL 再利用 | 高: 既存の `multi-select`/`/api/download-zip` をそのまま流用 | 中: 機能ごとに再実装が必要 |
| Compare 再利用 | 中: 動画 compare は別実装が必要だが基盤 (タブ・グリッド・toolbar) は共有 | 低: compare 自体を別系統で組む |
| URL ルーティング (`#album=`) | そのまま、または `#gallery=` に拡張 | 動画用に `#videos=` を追加 (経路二重化) |
| 保守性 | 単一の関心事「メディアタイル」に集約され、変更点が一箇所 | コードベースが「画像経路/動画経路」に二分し DRY 違反 |
| UI 一貫性 | 高: タイルサイズスライダー・選択・並び順等が共通 | 低: 同じ操作なのに別 UI になりがち |
| 実装コスト | 低〜中: ほぼ既存ファイルへの追加 | 中〜高: 新ファイル群 |
| 将来拡張 (PDF サムネ等) | 高: ギャラリー基盤が育つ | 低: 機能ごとに新設が必要 |

### 推奨: **A (アルバムを「ギャラリー」に一般化)**

理由:

- 既存のタイル CSS (`--album-tile-size` スライダー、ホバー、選択状態) と複数選択・ZIP DL 経路をそのまま再利用できる。
- 画像と動画は「一覧 → 詳細」のメンタルモデルが完全に同一で、ユーザに 2 つの導線を学ばせる必然性がない。
- `renderAlbum` 内のタイル生成箇所はメディア種別での分岐が局所化できる規模 (タイル要素 ≒ 数十行) であり、抽象を増やさず if 分岐で吸収できる。
- 後方互換性のため、URL ルーティング上は `#album=` を維持する (詳細は §10)。内部識別子と関数名は `gallery` 系へ段階的に寄せる。

### 名称ポリシー

- 公開 URL: `#album=` を維持 (旧リンク互換)。新規に `#gallery=` を追加するかは Phase 3 で再評価。
- フロント API/関数名: `loadAlbumView` → 段階的に `loadGalleryView` (export エイリアスで共存)。
- サーバ API: `/api/album` を `/api/gallery` にリネーム。`/api/album` は薄いプロキシとして残す (§5)。
- ファイル名: `src/album-viewer.ts` は当面現状維持 (リネームは別 PR で)。

---

## 4. ファイル別変更点

### `src/main.ts`

- 154 行付近の拡張子定数に `VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov'])` を追加。
- `FileType` 型に `'video'` を追加し、`detectFileType` で `VIDEO_EXT.has(ext)` を `image` の前後どちらでもよいので分岐。
- `loadServerFile` 経路に `case 'video':` を追加し、単一動画ファイルが `#file=` で開かれた場合は **Lightbox 単体モード** (ギャラリーを介さない `<video controls>` ペイン) で表示。動画は文字としてレンダリングしない。
- `parseHash` / `buildAlbumHash`: 後方互換のため `#album=` の解釈は変えない。Phase 3 で `#gallery=` 追加時にここを拡張。
- `loadAlbumView` を内部的に「メディアタイプを分けず両方表示する」関数に。`renderAlbum` への引数は変えない (§5 の `/api/gallery` レスポンスに種別が入る)。
- `renderCompare` は当面 image 専用と明示し、動画パスが混じった場合は早期リターン + Toast (Phase 3 で動画 compare サポート判断)。

### `src/album-viewer.ts`

- `AlbumImage` 型を `GalleryItem` に拡張し、`kind: 'image' | 'video'` と任意 `durationSec?: number` を保持。
- `renderAlbum` 内のタイル生成部 (916-1049 付近):
  - メディア種別に応じてタイル中央の表示要素を切り替える。画像はそのまま `<img loading="lazy">`、動画は `<video preload="metadata" muted playsinline>` (詳細は §6)。
  - 動画タイルには `.album-tile__video-badge` (再生時間) と `.album-tile__type-overlay` (▶ 三角アイコン) を absolute で重ねる。
- `openLightbox` (539-601):
  - 種別判定して画像なら現行ロジック、動画なら新設の `openVideoLightbox(index)` に分岐。
  - キーボードハンドラを共通シェルに切り出し、種別ごとに登録キーを差し替える (§7)。
- `updatePreloadLinks` (281-299):
  - 画像は `<link rel="preload" as="image">`、動画は `<link rel="preload" as="video">` を試みつつ、Range request 前提のため preload は Phase 2 で慎重に有効化 (Phase 1 では動画を preload しない)。
- 複数選択・ZIP DL は変更不要 (パス文字列ベースで動作)。
- compare ボタンのバリデーション: 選択に動画が含まれる場合は活性 (Phase 3) または disabled + tooltip (Phase 1/2)。

### `src/filetree.ts`

- `SVG_VIDEO` を新規追加 (フィルム/再生三角のシンプル線画。後述 §8)。
- `EXT_MAP` に `mp4`/`m4v`/`webm`/`ogv`/`mov` を `category: 'video'` で登録。CSS で `file-icon--video` 用のアクセントカラー (画像 `--video` と差別化) を `index.html` 側のスタイルに足す。
- `IMAGE_EXTS` を `MEDIA_EXTS` (画像 ∪ 動画) に拡張するか、`VIDEO_EXTS` を併設してカウントを `image+video` の合計で計算する。**推奨: `MEDIA_EXTS` を新設し画像/動画の合計でアルバムボタンを出す。**
- 164-171 のアルバムボタン文言を「Album view (N images)」から、内訳に応じて以下に動的化:
  - 画像のみ: `Album view (N images)`
  - 動画のみ: `Gallery view (N videos)`
  - 混在: `Gallery view (N items: I images, V videos)`
- ボタンアイコンも混在時は `ICON_ALBUM`、動画のみは新規 `ICON_GALLERY_VIDEO` を出す (Phase 1 では `ICON_ALBUM` 流用でも可)。

### `server.mjs`

- 498 行付近に `VIDEO_MIME` を追加。

  ```js
  const VIDEO_MIME = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
  };
  const VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_MIME));
  ```

- `/api/file` (852-908): バイナリ判定を「`IMAGE_EXTENSIONS` または `VIDEO_EXTENSIONS`」に拡張し、動画は **必ず Range request 対応で配信** (§5)。
- `/api/album` (1092-1174):
  - 内部の `collectImages` を `collectMedia` にリネームし、画像と動画の両方を列挙。
  - レスポンス各項目に `kind: 'image' | 'video'` を追加。`/api/album` は後方互換のため画像のみフィルタしたレスポンスも `?kind=image` で返せるようにする。
  - 新規 `/api/gallery` は `?kind=image|video|all` (デフォルト `all`) を受け付ける。
- `/api/download-zip` は変更不要 (パス配列を素直に ZIP 化するだけ)。
- Chokidar 監視対象に動画拡張子を追加 (現状 watch 対象が拡張子で絞られているなら更新)。SSE のメッセージ形式は変更不要。

---

## 5. 新規 API / 既存 API の変更

### `/api/album` を一般化するか、別エンドポイント `/api/videos` を作るか

| 案 | 利点 | 欠点 |
|----|------|------|
| (a) `/api/album` をそのまま拡張し動画も返す | 互換性最大、フロント側分岐最小 | レスポンス形に `kind` が混じり旧クライアントが動画を画像として誤解する恐れ |
| (b) `/api/gallery` を新設し `/api/album` は画像のみのまま残す (推奨) | 互換性維持、責務明確、`?kind` で柔軟にフィルタ | 一時的にエンドポイントが 2 つ存在 |
| (c) `/api/videos` を別途新設 | 単純 | 画像/動画の混在ディレクトリで 2 リクエスト必要・タイル並び順を結合する処理がフロントに漏れる |

**推奨: (b)**

```
GET /api/gallery?path=<dir>&recursive=0|1&kind=image|video|all
→ 200 application/json
{
  "root": "<dir>",
  "items": [
    { "path": "a/b/cat.png",  "kind": "image", "size": 12345, "mtime": "..." },
    { "path": "a/b/clip.mp4", "kind": "video", "size": 9876543, "mtime": "...", "durationSec": 12.3 /* 取得できれば */ }
  ]
}
```

- `/api/album` は内部で `/api/gallery?kind=image` を呼ぶ薄い互換ラッパとして残す。
- `durationSec` はサーバが安価に取得できる場合のみ含める (§6 で議論)。Phase 1 では未提供で構わない。
- ソート順は既存と同じ (パス昇順)。

### Range request (HTTP 206) 対応 ── 必須

#### なぜ必須か

- `<video>` 要素はシーク時に `Range: bytes=START-END` で部分取得を試みる。サーバが 200 全送信しか返さないと、Chrome は最初から最後まで一括ロードを試み、巨大ファイルでメモリ・帯域を圧迫し、Safari ではシークそのものが効かない。
- 動画再生開始時にも moov atom 取得のため複数の Range が飛ぶことがある。
- これに対応しないと「再生はできるがシークできない」「数百 MB 動画でブラウザが固まる」という UX 故障が常態化する。

#### サーバ実装方針 (`server.mjs` `/api/file` パッチ)

1. `Accept-Ranges: bytes` を全動画レスポンスに付与。
2. リクエストヘッダの `Range` を解析。形式は `bytes=<start>-<end>` (end 省略可) と `bytes=-<suffix>` (末尾 suffix バイト) の 2 形態。
3. 範囲が妥当なら `206 Partial Content` を返し、`Content-Range: bytes <start>-<end>/<total>`、`Content-Length: <chunkLen>` を設定。
4. 範囲が無効なら `416 Range Not Satisfiable` + `Content-Range: bytes */<total>`。
5. `Range` ヘッダ無しは従来どおり `200 OK` で全送信 (ただし `Content-Length` を必ず付ける)。
6. ストリーミング送信は `fs.createReadStream(resolved, { start, end })` で行い、メモリにフルロードしない。`pipe(res)` を用い、`res.on('close')` でストリームを破棄する。
7. `safePath` のシンボリックリンク検査は従来どおり最初に通す (パストラバーサル防止)。

例 (擬似コード):

```js
// HTTP example flow
// Request
//   GET /api/file?path=movie.mp4
//   Range: bytes=0-1048575
// Response
//   HTTP/1.1 206 Partial Content
//   Content-Type: video/mp4
//   Content-Range: bytes 0-1048575/52428800
//   Content-Length: 1048576
//   Accept-Ranges: bytes
//   Cache-Control: no-store
```

```js
function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end   = m[2] === '' ? null : parseInt(m[2], 10);
  if (start === null && end === null) return null;
  if (start === null) { start = total - end; end = total - 1; }
  if (end === null || end >= total) end = total - 1;
  if (start < 0 || start > end || start >= total) return null;
  return { start, end };
}
```

8. キャッシュ方針: 動画は `Cache-Control: no-store` (Chokidar の更新検知と整合させるため)、または `max-age=5` 程度に抑える。`X-File-Mtime` は引き続き付与。
9. CORS は localhost のみで継続。

### `/api/download-zip` の動画対応

- 既存の API は paths 配列を受け取る汎用実装なので、追加変更は不要。
- ただし動画の合計サイズが大きくなりがちなため、フロント側で「合計サイズが ≧ 500 MB のとき確認ダイアログを出す」ガードを Phase 2 で追加する。

---

## 6. 一覧表示 (タイル) の設計

### 課題

動画にはサムネイル PNG が同梱されない。タイルにそれっぽい絵を出すには 4 つの選択肢がある。

### サムネイル戦略の比較 (実装コストの低い順)

| 案 | 仕組み | 実装コスト | 描画コスト/ネットワーク | 見栄え |
|----|--------|-----------|------------------------|--------|
| 1. プレースホルダ画像 + ファイル名 | 黒地 + `▶` アイコン + 拡張子バッジ | 極小 | ゼロ | 殺風景 |
| 2. `<video preload="metadata" muted playsinline>` のみ (推奨開始点) | ブラウザが先頭フレームを表示 | 小 | metadata 分の Range のみ (数百 KB) | 多くの動画で「先頭フレーム = 真っ黒」問題 |
| 3. 案 2 + JS で `currentTime = 0.1` を設定し 1 フレーム描画させる | seeked 後に静止 | 小〜中 | 案 2 + 数 MB の Range | 真っ黒回避できる確率が上がる |
| 4. タイル hover で 0.5 倍速の数秒ループ再生 | mouseenter/leave で `play()`/`pause()` | 中 | 体感的に重い (複数タイル同時) | リッチだが負荷高 |
| 5. サーバ側 ffmpeg で PNG 生成 → キャッシュ | `/api/thumbnail?path=...&t=1` | 高 | 一度生成すれば最軽 | 最良。だが ffmpeg 依存追加 |

### 推奨: **Phase 1 で 2 + 3 を採用、Phase 3 で 4 を opt-in、5 はスコープ外**

- Phase 1: `<video preload="metadata" muted playsinline>` を出し、`loadedmetadata` 後に `currentTime = Math.min(0.1, duration * 0.1)` を設定して 1 フレームを表示。`seeked` で `pause()` 維持。
- Phase 3: 設定トグル「Hover preview (experimental)」を加え、ON のときのみ hover で 5 秒ループ再生 (mouseleave で停止)。デフォルト OFF。
- Phase での ffmpeg 連携 (案 5) は「依存追加禁止」「Vanilla 維持」という方針に合わないため見送り。

```html
<!-- HTML example: a single video tile -->
<div class="album-tile" data-kind="video" data-path="clips/walk.mp4">
  <video class="album-tile__video"
         src="/api/file?path=clips%2Fwalk.mp4"
         preload="metadata"
         muted
         playsinline
         tabindex="-1"></video>
  <span class="album-tile__type-overlay" aria-hidden="true">&#9658;</span>
  <span class="album-tile__duration-badge">0:12</span>
  <span class="album-tile__filename" title="walk.mp4">walk.mp4</span>
</div>
```

### 表示要素

- **動画識別オーバーレイ**: タイル中央に半透明の三角再生アイコン。CSS `position: absolute; inset: 0;` のフレックスセンタリング、`pointer-events: none`。アクセシビリティ用に `aria-label="video"` をタイル全体に付与。
- **再生時間バッジ**: 右下 (推奨) に `mm:ss` または `h:mm:ss`。`<video>` の `loadedmetadata` から `duration` を取得し、`Number.isFinite` でガードしてから整形。`duration` が `Infinity` の場合は非表示 (一部 webm 等で発生)。
- **位置の選択**: 左下は既存の filename バッジが伸びる場合があるため、duration は **右下** を推奨。
- **タイルサイズ**: 既存 `--album-tile-size` CSS 変数をそのまま流用。動画タイルは画像と同じ `aspect-ratio: 1 / 1` で `object-fit: cover` 風 (`<video>` には `object-fit` が効くブラウザが多いが効かない場合は中央クロップを CSS で再現)。
- **ロード失敗**: `<video>` の `error` イベントで案 1 のプレースホルダ + 「再生不可」テキストにフォールバック。
- **大量動画時のパフォーマンス**: `IntersectionObserver` で viewport に入ったタイルのみ `<video>` を生成 (それまでは案 1 のプレースホルダ)。`loading="lazy"` は `<video>` には効かないので IntersectionObserver が必須。

### サーバ側 duration の扱い

- Phase 1 ではサーバから `durationSec` を返さない。フロント側 `loadedmetadata` で取得する。
- Phase 2 で必要なら mp4/webm の moov atom を Node 純正でパースする軽量実装を入れる (依存追加なし)。広範な互換が必要になったら Phase 5 に格上げ判断。

---

## 7. 詳細表示 (Lightbox 拡張) の設計

### 構造

既存 `openLightbox(index)` (`src/album-viewer.ts:539`) を分岐させる。

- 画像: 現行どおり `<img>` + zoom/pan/zoom-reset。
- 動画: `<video controls preload="metadata" autoplay muted playsinline src="/api/file?path=...">`
  - `autoplay` + `muted` は意図的 (ブラウザの自動再生ポリシー回避)。ユーザがアンミュートしたら以後の動画にも記憶 (sessionStorage)。
  - zoom/pan/wheel-zoom は無効化 (`<video>` には不適切)。

### キーボードショートカット (動画 Lightbox)

衝突する設計を慎重に分離する。

| キー | 挙動 |
|------|------|
| `Space` | 再生 / 一時停止 |
| `K` | 同上 (YouTube 互換) |
| `M` | ミュート切替 |
| `F` | フルスクリーン切替 (`requestFullscreen` on `<video>`) |
| `Esc` | フルスクリーン解除、それ以外は Lightbox を閉じる |
| `J` / `L` | 10 秒戻る / 10 秒進む |
| `,` / `.` | 1 フレームずつ戻る/進む (一時停止中のみ。`currentTime ±= 1/30`) |
| `0`〜`9` | 動画長の 0%〜90% にジャンプ |
| `←` / `→` | **前/次の動画にナビゲーション** (画像と同じ) |
| `Shift` + `←` / `→` | 5 秒シーク (左右シーク用の専用修飾。10 秒ステップを変えたい人向け) |
| `↑` / `↓` | 音量 +/-10% |
| `Home` / `End` | 先頭 / 末尾 |

### `←/→` の競合解決

設計判断: **左右矢印は前/次のメディアナビ。シークは `J`/`L` または `Shift+矢印`。**

- 理由: 画像 Lightbox と一貫させ、ギャラリー (画像+動画混在) を矢印で歩き回るメンタルモデルを壊さない。
- YouTube は `←/→` がシークだが、docview のコンテキストは「複数ファイルをめくる」が主目的なので Photos/Finder 系の挙動を採る。
- ヘルプモーダル (`?`) で動画 Lightbox 専用キー一覧を表示する。

### Volume / Mute / Fullscreen

- ボリュームスライダーはネイティブ `controls` UI を使う。独自 UI は作らない。
- ボリュームは `localStorage.docview.video.volume` に永続化。新規 Lightbox 開始時に適用。
- フルスクリーンは Lightbox 内の `<video>` を対象に `requestFullscreen()`。Lightbox の overlay を fullscreen 対象にしない (controls が隠れるため)。

### 画像との UI 共通化

- Lightbox の chrome (close button, prev/next ナビ, counter `1/N`) は画像と完全共有。`buildLightboxHtml` を媒体種別パラメータ受け取りに改修。
- 既存の zoom UI ボタン (+/-/reset) は動画 Lightbox では非表示にする。

### 初回 autoplay 制限への対応

- Lightbox 起動時に `play()` が reject されたら、中央に大きな再生ボタンを表示してクリック待ち。
- ユーザがクリックしたら以降の Lightbox は autoplay を試みる (sessionStorage で一度だけのジェスチャー記憶)。

### 隣接 preload

- 画像と異なり動画の preload は重い。次の 1 動画のみ `<link rel="preload" as="video">` を Phase 2 で試験導入し、効果が薄ければ削除。Phase 1 では preload しない。

---

## 8. ファイルツリーでの表示

### 動画アイコン (新規 `SVG_VIDEO`)

シンプルな線画でフィルム or 再生三角を表現する。サイズ・stroke は既存 `SVG_IMAGE` と揃える。

```ts
const SVG_VIDEO = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor"
  stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="1.5" y="3" width="11" height="8" rx="1"/>
  <polygon points="6,5.5 6,8.5 9,7" fill="currentColor" stroke="none"/>
</svg>`;
```

`EXT_MAP` に video カテゴリを追加し、CSS `--icon-color-video` を `index.html` の theme tokens に定義 (light/dark 両方)。

### 「Gallery view」ボタンの文言出し分け

`src/filetree.ts` 164-171 のロジックを次のように拡張する。

| 内訳 (直接の子のみカウント) | アイコン | tooltip / aria-label |
|------------------------------|----------|------------------------|
| 画像のみ N 件                | `ICON_ALBUM` | `Album view (N images)` |
| 動画のみ N 件                | `ICON_GALLERY_VIDEO` (Phase 2) または `ICON_ALBUM` | `Gallery view (N videos)` |
| 画像 I 件 + 動画 V 件 (混在) | `ICON_ALBUM` | `Gallery view (N items: I images, V videos)` |
| いずれも 0 件                | ボタン非表示 | — |

カウントバッジの数字は合計 (I + V) を表示する。

### 再帰オプション (`recursive=1`) との整合

既存どおり `recursive=1` のときは下位ディレクトリも対象。文言生成は Phase 1 では「直接の子のみ」のカウントを基準にする (再帰時のカウントはサーバ問い合わせが必要になるため)。

---

## 9. 比較ビュー (Compare) の扱い

### 結論: **Phase 1/2 ではスコープ外。Phase 3 で 2 ペイン限定の動画 compare を opt-in 実装。**

### Phase 3 の方針

- 最大 2 ペイン (画像の 2-4 とは別の上限)。理由: 4 つの動画を同時デコードはブラウザが厳しい。
- `Sync Play` チェックボックスを既存 `Sync Zoom` の隣に追加。ON のとき:
  - 一方の `play`/`pause`/`seeked` を他方に反映 (許容ドリフト 0.05 秒以内)。
  - 同期は片方が ready でないときは保留。
- `Sync Volume` も同様。
- 画像 + 動画の混在 compare は許可しない (Phase 3 開始時点)。混在選択時は compare ボタンを disabled + tooltip。
- ループは個別、シークは sync 時のみ追従。
- 動画 compare 時は `<video controls>` を 2 ペイン並べ、独自 UI は作らない。

### Phase 1/2 の挙動

- `renderCompare` に動画パスが渡された場合は何もしない (or Toast「動画 compare は未対応」)。
- アルバム選択ツールバーの compare ボタンは「選択に動画が 1 件でも含まれていれば」disabled + tooltip。

---

## 10. ルーティング

### `#album=` を `#gallery=` にリネームすべきか

| 案 | 利点 | 欠点 |
|----|------|------|
| (i) `#album=` を維持 (推奨) | 既存ブックマーク・SSE クライアント・Playwright テストが無傷 | 「動画も入っているのに album」という名前のずれ |
| (ii) `#gallery=` にリネームし `#album=` を 301 風にリダイレクト | 名実一致 | ブックマーク互換のため両方サポートを永続化する必要 |
| (iii) 両方並列でサポート (両方解釈、新規発行は `#album=`) | 互換性最大 | 微小な複雑度増 |

### 推奨: **(i) `#album=` 維持。Phase 3 終了時点で利用状況に応じて (iii) を再評価。**

- 内部の関数名・サーバ API は `gallery` に揃える (§3 名称ポリシー)。URL 表面だけは互換最優先。
- 単一動画ファイルは `#file=path/to/clip.mp4` で開く (画像と同じ規約)。`detectFileType` が `'video'` を返したら main.ts が Lightbox 単体モードを起動する。
- `#compare=` は Phase 3 で「全パスが画像 / 全パスが動画」のいずれかを許容するように拡張。混在は早期に弾く。

---

## 11. 依存関係

### 新規ライブラリ: **不要**

- `<video>` 要素はブラウザ内蔵。Range request はサーバ側で `fs.createReadStream` (Node 標準) のみで実装。
- HLS (`hls.js`) や DASH (`dash.js`) は対象外であり追加しない (§1 スコープ外)。
- ffmpeg / ffprobe など外部プロセスへの依存は導入しない (CLI 配布の単純性が崩れるため)。
- `package.json` の `dependencies` / `devDependencies` への追加はゼロ。

### 既存依存への影響

- Chokidar: 監視対象拡張子の追加のみ (グロブパターン更新)。
- DOMPurify: 動画には無関係。
- highlight.js / KaTeX / Mermaid: 影響なし。

---

## 12. 段階的実装プラン

### Phase 1: 最小機能 (一覧 + 詳細)

スコープ:

- フロント `VIDEO_EXT` / `detectFileType('video')`、Lightbox 単体モード。
- `src/album-viewer.ts`: 動画タイル (`<video preload="metadata" muted playsinline>` + 先頭フレーム表示) と動画 Lightbox (controls + 基本キーボード)。
- `src/filetree.ts`: 動画アイコンと文言出し分け。
- `server.mjs`: `VIDEO_MIME` / `VIDEO_EXTENSIONS`、`/api/file` の動画配信 (**この時点で Range 必須**)、`/api/gallery` 新設、`/api/album` の互換ラッパ。
- E2E: Playwright で再生開始・前後ナビ・拡張子未対応時の挙動を確認。

完了条件:

- `.mp4` / `.webm` ファイルを `samples/` に置いて `mdv samples/` を実行すると、ファイルツリーに動画アイコンが出る。
- ディレクトリの「Gallery view」ボタンから一覧を開ける。
- タイルに先頭フレームが表示される (`.mov` H.264 含む)。
- タイルクリックで Lightbox が開き、`Space`/`←`/`→`/`Esc` が動く。
- 100 MB 動画でブラウザが固まらず、シークバーがまともに動く (Range 機能の検収)。
- 既存の画像アルバム動作が回帰していない (Playwright 既存テスト全 PASS)。

### Phase 2: Range 強化、サムネイル改善

スコープ:

- `currentTime` 微調整によるサムネイル真っ黒回避を全動画で適用。
- IntersectionObserver による viewport 限定の `<video>` 生成 (大量動画時の負荷低減)。
- duration バッジ表示。
- 隣接動画 preload を試験導入し、計測で OK ならデフォルト ON。
- ZIP DL 合計サイズ警告 (≧ 500 MB)。
- 単体ファイル `#file=clip.mp4` 経路の磨き込み (タブバー文言、breadcrumb)。

完了条件:

- 50 個の動画を並べてスクロールしても初期ロードが軽い (タイル化ロード)。
- 主要動画でサムネイルが真っ黒にならない確率が体感 90% 以上。
- duration バッジが ±1 秒以内で正しい。

### Phase 3: Compare、Hover preview

スコープ:

- 2 ペイン動画 compare (`Sync Play` / `Sync Volume` トグル)。
- Hover preview (opt-in 設定)。
- ヘルプモーダルに動画キー一覧追加。
- `#gallery=` ルーティングの並列サポート判断 (利用状況見て決定)。

完了条件:

- 2 動画選択 → compare ボタンで sync 再生でき、シーク同期のドリフトが 0.1 秒以内。
- Hover preview ON で 10 タイル可視時にフレーム落ちが顕著でない (CPU < 50%)。
- ヘルプに動画キー一覧が反映され、`?` モーダルから一覧できる。

---

## 13. テスト観点 (Playwright E2E)

`tests/` 配下に新規 `tests/video.spec.ts` を作成する想定。テスト用の小さな mp4/webm をリポジトリに置く (1 MB 程度) か、`/tmp/md-test-docs` に Playwright fixture でコピー。

### 確認項目

1. **ファイルツリー**
   - `.mp4` / `.webm` / `.mov` / `.ogv` / `.m4v` ファイルが動画アイコンで表示される。
   - 動画のみのディレクトリで `Gallery view (N videos)` ボタンが出る。
   - 混在ディレクトリで `Gallery view (N items: I images, V videos)` が出る。
2. **Gallery 一覧**
   - 動画タイルに `<video>` 要素が描画される。
   - タイル中央に三角オーバーレイがある。
   - 再生時間バッジが表示される (Phase 2 以降)。
3. **Lightbox 再生**
   - タイルクリックで `<video controls>` が開き autoplay (muted) で再生開始。
   - `Space` で一時停止 / 再開できる。
   - `J`/`L` で 10 秒シークできる (`currentTime` の差分検証)。
   - `←`/`→` で前後の動画に切り替わる。
   - `Esc` で Lightbox が閉じる。
4. **Range request**
   - 大ファイル (10 MB 以上を fixture として準備) で `currentTime = 5` を設定 → Network 検査で 206 が観測される。
   - サーバログ (`X-Range-Start` をデバッグヘッダで仕込んで検証) で正しい範囲が要求されている。
5. **拡張子未対応**
   - `.mkv` ファイルがディレクトリにあっても Gallery のカウントに含まれない。
   - `<video>` の error イベントを擬似的に発火させると Lightbox に再生不可メッセージが出る (Phase 1.5)。
6. **互換 URL**
   - `#album=<path>` で開いて画像と動画が混在表示される (`/api/album` が動画も返すか、`/api/gallery` への内部移行で同等のレンダリングになるか)。
7. **回帰**
   - 既存の画像アルバム/Compare/ZIP DL がすべて従来どおり通る。

### 計測ポイント (手動 + Lighthouse 任意)

- 50 タイル時のレンダ時間 < 1 秒 (Phase 2)。
- 100 MB 動画オープン時のメモリ増加 < 150 MB。

---

## 14. リスクと未解決事項

### リスク

- **大容量動画の帯域**: Range 対応必須にすることで一括ロードは避けられるが、複数タイルが metadata を同時 fetch すると localhost でも帯域を食う。IntersectionObserver の早期導入で緩和。
- **メモリ**: 同時に多数の `<video>` を生成すると Chrome の WebMediaPlayer 上限に達する (Chrome の上限は近年 ~75)。viewport 限定生成で回避。
- **コーデック互換**: `.mov` (HEVC/ProRes) は再生不可になることがある。エラー UI で明示。
- **サムネイル真っ黒**: 先頭フレームが黒いまま終わる動画がある (`currentTime` 微調整も効かないケース)。Phase 3 でサーバ ffmpeg を再検討する余地。
- **SSE / Chokidar との相互作用**: 動画ファイルを保存中にイベントが飛び、未完成な動画を再生して error になる可能性。debounce (既存に倣い 200ms 程度) と ETag/mtime ベースのリロード抑制で緩和。
- **Lightbox 中の SSE リロード**: ユーザが視聴中に再ロードされると体験を壊す。視聴中 (= `<video>.paused === false`) は SSE 自動リロードを保留する制御を入れる。
- **ZIP DL の負荷**: 巨大動画を ZIP に固める間サーバが詰まる可能性。Phase 2 のサイズ警告 + 段階的に Streaming ZIP に切り替える検討。
- **アクセシビリティ**: タイル動画には `aria-label="video: <filename>"` を付与し、screen reader 向けに「再生時間 N 秒」を追加。`prefers-reduced-motion` のユーザに対しては Hover preview を強制 OFF。

### 未解決事項 (#TODO(agent))

- `#TODO(agent)`: `.mov` の内部コーデック判定をサーバで行うか (mp4parse 系の軽量自前実装の可否)。Phase 2 検討。
- `#TODO(agent)`: duration を `/api/gallery` で返す軽量実装 (mp4 moov atom の最小パース) の必要性検証。
- `#TODO(agent)`: 単体動画ファイル経路 (`#file=clip.mp4`) のタブ復元・スクロール記憶の扱いを画像経路と一貫させるかの仕様確定。
- `#TODO(agent)`: `prefers-reduced-motion` 時のサムネイル戦略 (Phase 1 で先頭フレームのみで十分だが、Phase 3 の Hover preview を強制 OFF にする UI 通知の文言)。
- `#TODO(agent)`: `recursive=1` 時の文言生成のためサーバから件数内訳を返すかの判断 (Phase 2)。

---

## 付録: 参照ファイル位置

- `src/main.ts:154-179` 拡張子定数と `detectFileType`
- `src/main.ts:397-456` URL ハッシュルーティング
- `src/main.ts:912-941` `loadAlbumView`
- `src/main.ts:1045-1123` `renderCompare`
- `src/album-viewer.ts:281-299` 隣接 preload
- `src/album-viewer.ts:539-601` `openLightbox`
- `src/album-viewer.ts:916-1049` `renderAlbum`
- `src/filetree.ts:25-76` `EXT_MAP` / アイコン定義
- `src/filetree.ts:164-171` Album view ボタン生成
- `server.mjs:498-523` `IMAGE_MIME` 定義
- `server.mjs:852-909` `/api/file` 配信
- `server.mjs:1092-1174` `/api/album` `collectImages`

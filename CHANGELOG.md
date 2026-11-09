# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Diff view for text files: side-by-side / unified layouts, word-level highlights, change navigation, whitespace-insensitive comparison, expandable context, jump-to-line, and patch copy / download. Secret Safe mode masks both sides.
- Live change review: a chip shows `+N −M` when an open file changes on disk, opening a diff against the version first opened in the session (`D` shortcut).
- Git history: compare a file with `HEAD` or recent commits (`/api/git/log`, `/api/git/show`), Git change badges in the file tree and a "Git: 変更のみ" filter (`/api/git/status`).
- Link check: broken relative links, images, reference definitions and wiki links across Markdown documents (`/api/links/check`), shown per document in the TOC panel and as a folder report.

### Performance

- Text decoding skips the encoding detector for plain-ASCII files (which decode identically under every supported encoding): full-text search, backlinks and file loading spend far less CPU.
- Plain full-text search skips the per-line scan for files that do not contain the query.
- `/api/tree` stats directory entries concurrently (bounded per directory).
- The file tree coalesces SSE add/unlink bursts into at most one follow-up `/api/tree` reload instead of one per event.
- Content-hashed `/assets/*` bundles are served with `Cache-Control: immutable`, so reloads no longer re-download them.

## 1.9.0 - 2026-07-30

### Changed

- Default search mode is now set to Full Text search across all files.

## 1.8.0 - 2026-07-23

### Added

- Added Zenn and novel-style reading themes.
- Added document text scaling from 50% to 200% with persistent preferences.
- Added Qiita-specific Markdown rendering for notes, named code fences, and article metadata.

### Changed

- Refined the Qiita article layout to match its article presentation more closely.
- Restored Mermaid diagrams in the Qiita theme to the library's default styling.

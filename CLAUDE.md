# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DocView (`docview` / `mdv`) — Node.js CLI tool that serves a local directory as a rich document viewer in the browser. Vanilla TypeScript SPA frontend + native `node:http` backend with SSE-based live reload.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # tsc + vite build → dist/
npm run serve        # Build then launch server.mjs
npm run test:e2e     # Playwright E2E tests (requires Chromium)
npx playwright test tests/core.spec.ts --headed  # Run single test file with browser visible
```

Tests expect the server on port 4000 — Playwright config auto-starts `node server.mjs /tmp/md-test-docs --port 4000`.

No linter/formatter configured; TypeScript strict mode is the quality gate.

## Architecture

**Server (`server.mjs`)** — Stateless HTTP server, no framework. Key API:
- `GET /api/tree` — recursive file tree JSON
- `GET /api/file?path=` — file content with path-traversal protection (symlink check)
- `GET /api/search?q=` — full-text grep across served directory
- `GET /api/watch` — SSE stream; Chokidar broadcasts file changes to all connected clients
- `GET /api/custom-css` — loads `.docview.css` from the served directory

**Frontend (`src/`)** — Vanilla TypeScript SPA, no framework. Each UI concern is a separate module:
- `main.ts` — app shell, routing (`#file=path`), file fetching, scroll memory, code-block copy buttons
- `markdown.ts` — markdown-it pipeline with GFM, footnotes, KaTeX, Mermaid, DOMPurify sanitization, GitHub Alerts
- `filetree.ts` / `tabs.ts` / `toc.ts` / `search.ts` / `find-bar.ts` — sidebar, tabs, TOC, search modal, vim-style find
- `json-tree.ts` / `yaml-tree.ts` / `csv-viewer.ts` — structured data viewers (tree views, tables)
- `theme.ts` — light/dark toggle with localStorage persistence

**CLI (`bin/mdv.mjs`)** — Parses args, imports server, auto-opens browser.

**Data flow:** User action → fetch `/api/file` → server reads file with security checks → frontend detects type by extension → renders with appropriate handler. File changes → Chokidar → SSE → frontend auto-reloads affected file.

## Key Dependencies

| Purpose | Library |
|---------|---------|
| Markdown | markdown-it + plugins (footnote, sub/sup, emoji, deflist, front-matter, container) |
| Math | KaTeX |
| Diagrams | Mermaid |
| Code highlighting | highlight.js |
| HTML sanitization | DOMPurify |
| CSV | PapaParse |
| YAML | yaml |
| File watching | Chokidar |

## Conventions

- Commit messages in Japanese, conventional commit style
- ES Modules throughout (`"type": "module"`)
- No frontend framework — DOM manipulation is direct
- Security: path traversal prevention, CSP headers, CORS restricted to localhost

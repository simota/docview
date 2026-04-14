# DocView

> Beautiful document viewer for Markdown, YAML, JSON, config files, and images — served locally in your browser.

## Features

- **Markdown rendering** — full CommonMark support with GitHub Flavored Markdown, footnotes, definition lists, subscript/superscript, emoji, and front matter
- **Mermaid diagrams** — flowcharts, sequence diagrams, ER diagrams, and more rendered inline
- **KaTeX math** — inline and block LaTeX math expressions
- **GitHub Alerts** — `[!NOTE]`, `[!WARNING]`, `[!TIP]`, `[!IMPORTANT]`, `[!CAUTION]` callout blocks
- **YAML / JSON tree views** — structured, collapsible tree rendering for data files
- **Config file highlighting** — syntax highlighting for TOML, INI, `.env`, `.conf`, and similar formats
- **Image display** — renders PNG, JPEG, GIF, SVG, WebP, BMP, and ICO files directly in the browser
- **File tree with auto-reload** — sidebar listing of all files in the served directory; changes are detected and reloaded automatically via file watching
- **Dark / light theme** — toggle between themes; preference is persisted
- **Table of contents** — auto-generated TOC sidebar from heading structure
- **Search** — full-text search across all files in the directory
- **Tabs** — open multiple files as tabs within a single session

## Supported Formats

| Category  | Extensions                                   |
|-----------|----------------------------------------------|
| Markdown  | `.md` `.markdown` `.mdx` `.txt`              |
| Data      | `.json` `.yaml` `.yml`                       |
| Config    | `.toml` `.ini` `.conf` `.env` `.cfg` `.properties` |
| Images    | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.bmp` `.ico` |

## Installation

```bash
npm install -g docview
```

## Usage

```bash
# View current directory
docview

# View a specific directory
docview ./docs

# Open a specific file
docview README.md

# Use the mdv alias with a custom port
mdv config.yaml -p 8080

# Don't auto-open the browser
docview ./docs --no-open
```

### Options

| Flag                  | Description                         | Default |
|-----------------------|-------------------------------------|---------|
| `-p`, `--port <port>` | Port number                         | `4000`  |
| `--no-open`           | Don't auto-open the browser         | —       |
| `-h`, `--help`        | Show help                           | —       |
| `-v`, `--version`     | Show version                        | —       |

## Keyboard Shortcuts

| Shortcut          | Action                              |
|-------------------|-------------------------------------|
| `Cmd/Ctrl + P`    | Quick file switcher                 |
| `Cmd/Ctrl + Shift + F` | Full-text search               |
| `Cmd/Ctrl + B`    | Toggle sidebar                      |
| `Cmd/Ctrl + E`    | Toggle table of contents            |
| `Cmd/Ctrl + Shift + E` | Toggle theme (dark / light)   |
| `?`               | Show keyboard shortcut help         |
| `↑` / `↓`         | Navigate file list / search results |

## Custom CSS

Place a `.docview.css` file in the directory you are viewing (or any parent directory). DocView will automatically load it and apply your styles on top of the default theme.

```css
/* .docview.css */
:root {
  --font-size-base: 16px;
}

.markdown-body h1 {
  border-bottom: 2px solid var(--color-accent);
}
```

## Tech Stack

- **[Vite](https://vitejs.dev/)** — build tooling and dev server
- **[TypeScript](https://www.typescriptlang.org/)** — type-safe frontend code
- **[markdown-it](https://github.com/markdown-it/markdown-it)** — Markdown parser with plugin ecosystem
- **[Mermaid](https://mermaid.js.org/)** — diagram and chart rendering
- **[KaTeX](https://katex.org/)** — fast LaTeX math rendering
- **[highlight.js](https://highlightjs.org/)** — syntax highlighting for code blocks and config files
- **[chokidar](https://github.com/paulmillr/chokidar)** — file system watcher for live reload

## License

MIT © 2026

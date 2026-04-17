# DocView

> Beautiful document viewer for Markdown, YAML, JSON, config files, and images — served locally in your browser.

## Try it in 10 seconds

No install needed. Open your terminal, `cd` into any folder with documents, and run:

```bash
npx github:simota/docview
```

Your browser opens at `http://localhost:4000` and the folder becomes a browsable document site. Press `Ctrl + C` to stop.

> **First time opening a terminal?** You only need to do this once.
> - **macOS** — Press `⌘ + Space`, type `Terminal`, press `Enter`.
> - **Windows** — Press the `Windows` key, type `PowerShell`, press `Enter`.
> - **Linux** — Press `Ctrl + Alt + T` (most distros), or search for `Terminal` in your apps.
>
> Then install [Node.js 20.19+](https://nodejs.org/) (the **LTS** button is the safe choice), close and reopen the terminal, and run the command above.

### Try it on a specific folder or file

```bash
npx github:simota/docview ./docs        # view a folder
npx github:simota/docview README.md     # open a single file
```

### Does it work? — quick verification

| OS | What to expect |
|----|----------------|
| macOS | Your default browser opens at `http://localhost:4000` with a file tree on the left. |
| Windows | Edge (or your default browser) opens at `http://localhost:4000` with a file tree on the left. |
| Linux | Your default browser opens at `http://localhost:4000` with a file tree on the left. |

If the browser doesn't open, copy `http://localhost:4000` into any browser — it works the same way.

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

## Installation (optional)

`npx github:simota/docview` works without installing anything — that is the recommended way for most people. Install globally only if you use DocView every day and want a shorter command.

### macOS / Linux

```bash
npm install -g github:simota/docview
```

Seeing `EACCES` / permission errors? **Don't use `sudo`.** Either stick with `npx github:simota/docview` (no install needed) or configure npm to use a user directory — [npm's official guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally) walks through it.

### Windows

```powershell
npm install -g github:simota/docview
```

Run PowerShell as a regular user — admin mode is not required.

### Verify the install

```bash
docview --version
```

If you see a version number, you're ready. Run `docview` inside any folder to start the viewer.

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

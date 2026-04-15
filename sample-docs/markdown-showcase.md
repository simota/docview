---
title: Markdown Showcase
author: DocView Team
date: 2025-01-15
tags: [markdown, gfm, showcase]
---

# Markdown Showcase

This document demonstrates all Markdown features supported by DocView.

## Text Formatting

This is **bold**, this is *italic*, this is ***bold and italic***.

This is ~~strikethrough~~, this is ==highlighted== (mark), and this is `inline code`.

This is ^superscript^ and this is ~subscript~.

## Links and Images

- [External link](https://github.com)
- [Internal link](README.md)
- [Link with title](https://github.com "GitHub Homepage")

## Blockquotes

> "Any sufficiently advanced technology is indistinguishable from magic."
>
> — Arthur C. Clarke

> Nested blockquotes:
>
> > This is a nested quote.
> >
> > > And even deeper.

## GitHub Alerts

> [!NOTE]
> This is a note alert. Useful for highlighting information.

> [!TIP]
> This is a tip alert. Suggests helpful advice.

> [!IMPORTANT]
> This is an important alert. Critical information users should know.

> [!WARNING]
> This is a warning alert. Potential issues users should be aware of.

> [!CAUTION]
> This is a caution alert. Advises about risks or negative outcomes.

## Lists

### Unordered List

- First item
  - Nested item A
  - Nested item B
    - Deep nested item
- Second item
- Third item

### Ordered List

1. First step
2. Second step
   1. Sub-step 2.1
   2. Sub-step 2.2
3. Third step

### Task List

- [x] Create project structure
- [x] Implement Markdown renderer
- [x] Add Mermaid support
- [ ] Write comprehensive tests
- [ ] Deploy to production

## Tables

| Feature | Status | Priority |
|:--------|:------:|----------:|
| Markdown rendering | Done | High |
| Live reload | Done | High |
| Dark mode | Done | Medium |
| Split view | Done | Medium |
| Export to PDF | Planned | Low |

### Wide Table

| ID | Name | Email | Department | Role | Location | Start Date | Status |
|----|------|-------|------------|------|----------|------------|--------|
| 001 | Alice Johnson | alice@example.com | Engineering | Lead | Tokyo | 2020-04-01 | Active |
| 002 | Bob Smith | bob@example.com | Design | Senior | Osaka | 2021-06-15 | Active |
| 003 | Carol White | carol@example.com | Marketing | Manager | Tokyo | 2019-11-20 | Active |
| 004 | Dave Brown | dave@example.com | Engineering | Senior | Remote | 2022-01-10 | Active |
| 005 | Eve Davis | eve@example.com | Product | Director | Tokyo | 2018-03-05 | On Leave |

## Code Blocks

### JavaScript

```javascript
class DocumentViewer {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.port = options.port ?? 4000;
    this.watchers = new Map();
  }

  async start() {
    const server = createServer((req, res) => this.handleRequest(req, res));
    server.listen(this.port, () => {
      console.log(`DocView running at http://localhost:${this.port}`);
    });
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    // Route to appropriate handler
    return this.router.match(url.pathname)?.(req, res);
  }
}
```

### Python

```python
import asyncio
from pathlib import Path
from dataclasses import dataclass, field

@dataclass
class Config:
    root_dir: Path
    port: int = 4000
    extensions: list[str] = field(default_factory=lambda: ['.md', '.yaml', '.json'])

    def is_supported(self, path: Path) -> bool:
        return path.suffix in self.extensions

async def watch_directory(config: Config):
    """Watch directory for file changes and notify clients."""
    async for changes in awatch(config.root_dir):
        for change_type, path in changes:
            if config.is_supported(Path(path)):
                await broadcast({"type": change_type, "path": path})
```

### SQL

```sql
SELECT
    d.department_name,
    COUNT(e.employee_id) AS employee_count,
    AVG(e.salary) AS avg_salary,
    MAX(e.hire_date) AS latest_hire
FROM employees e
JOIN departments d ON e.department_id = d.id
WHERE e.status = 'active'
GROUP BY d.department_name
HAVING COUNT(e.employee_id) > 5
ORDER BY avg_salary DESC;
```

### Shell

```bash
#!/bin/bash
set -euo pipefail

# Deploy script
echo "Building project..."
npm run build

echo "Running tests..."
npm test

echo "Deploying to production..."
rsync -avz --delete dist/ server:/var/www/app/

echo "Done! Deployed at $(date)"
```

### CSS

```css
:root {
  --bg: #f8f7f4;
  --text: #1a1a18;
  --accent: #1a7a40;
  --font-mono: ui-monospace, 'Cascadia Code', monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --text: #e6edf3;
  }
}

.document-viewer {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}
```

## Footnotes

DocView supports GitHub Flavored Markdown[^1] with several extensions including footnotes[^2] and definition lists.

[^1]: GFM is a strict superset of CommonMark with additional features like tables, task lists, and strikethrough.
[^2]: Footnotes allow you to add references without cluttering the main text.

## Definition Lists

DocView
: A local document viewer CLI tool for developers.
: Supports Markdown, YAML, JSON, CSV, and more.

Live Reload
: Automatic browser refresh when files are saved.
: Powered by Server-Sent Events (SSE).

Mermaid
: A JavaScript-based diagramming tool that renders Markdown-inspired text definitions.

## Emoji

:rocket: :star: :book: :bulb: :white_check_mark: :warning: :heart:

## Horizontal Rules

---

***

___

## HTML (Sanitized)

<details>
<summary>Click to expand</summary>

This content is hidden by default. DocView sanitizes HTML with DOMPurify to prevent XSS attacks while allowing safe elements like `<details>`.

- Item inside details
- Another item

</details>

<kbd>Ctrl</kbd> + <kbd>K</kbd> to search

Text with <abbr title="Hypertext Markup Language">HTML</abbr> abbreviation.

# Mermaid Diagrams

DocView supports [Mermaid](https://mermaid.js.org/) diagrams. All major diagram types are demonstrated below.

## Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Is file supported?}
    B -->|Yes| C[Read file content]
    B -->|No| D[Return 404]
    C --> E{Detect file type}
    E -->|Markdown| F[Render with markdown-it]
    E -->|YAML| G[Parse & show tree view]
    E -->|JSON| H[Parse & show tree view]
    E -->|CSV| I[Parse & show table]
    E -->|Image| J[Display image]
    F --> K[Apply syntax highlighting]
    K --> L[Render Mermaid diagrams]
    L --> M[Render KaTeX math]
    M --> N[Sanitize with DOMPurify]
    N --> O[Display in browser]
    G --> O
    H --> O
    I --> O
    J --> O
```

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant CLI as DocView CLI
    participant Server as HTTP Server
    participant Watcher as Chokidar
    participant Browser

    User->>CLI: npx github:simota/docview ./docs
    CLI->>Server: Start on port 4000
    Server-->>CLI: Listening
    CLI->>Browser: Open http://localhost:4000

    Browser->>Server: GET /api/tree
    Server-->>Browser: File tree JSON

    Browser->>Server: GET /api/file?path=README.md
    Server-->>Browser: File content

    Browser->>Server: GET /api/watch (SSE)
    Note over Browser,Server: SSE connection established

    User->>User: Edit README.md
    Watcher-->>Server: File changed
    Server-->>Browser: SSE: {type: "change", path: "README.md"}
    Browser->>Server: GET /api/file?path=README.md
    Server-->>Browser: Updated content
    Note over Browser: Auto-reload
```

## Class Diagram

```mermaid
classDiagram
    class Server {
        -port: number
        -targetDir: string
        -watcher: Chokidar
        +listen()
        +handleRequest(req, res)
        -buildTree(dir): TreeNode[]
        -readFile(path): string
        -broadcast(event, path)
    }

    class MarkdownRenderer {
        -md: MarkdownIt
        -mermaid: Mermaid
        -katex: KaTeX
        +render(content): string
        +initMermaid()
        +renderMath(content): string
    }

    class FileTree {
        -root: TreeNode
        -activeFile: string
        +build(data)
        +expand(path)
        +select(path)
        +filter(query)
    }

    class TabManager {
        -tabs: Tab[]
        -activeTab: Tab
        +open(path)
        +close(path)
        +switchTo(path)
        +reorder(from, to)
    }

    class SearchEngine {
        -query: string
        -results: SearchResult[]
        +search(query)
        +highlight(text)
        +navigateTo(result)
    }

    Server --> MarkdownRenderer : provides content
    MarkdownRenderer --> FileTree : rendered files
    FileTree --> TabManager : file selection
    TabManager --> SearchEngine : search context
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Loading: User clicks file
    Loading --> Rendering: Content received
    Rendering --> Displayed: Render complete
    Displayed --> Idle: User clicks another file

    Displayed --> Editing: File modified externally
    Editing --> Loading: SSE change event

    Displayed --> Searching: User opens search
    Searching --> Displayed: Result selected
    Searching --> Searching: Query updated

    state Rendering {
        [*] --> ParseMarkdown
        ParseMarkdown --> HighlightCode
        HighlightCode --> RenderMermaid
        RenderMermaid --> RenderKaTeX
        RenderKaTeX --> SanitizeHTML
        SanitizeHTML --> [*]
    }
```

## Entity Relationship Diagram

```mermaid
erDiagram
    PROJECT ||--o{ DOCUMENT : contains
    PROJECT {
        string id PK
        string name
        string rootDir
        datetime createdAt
    }

    DOCUMENT ||--|{ VERSION : has
    DOCUMENT {
        string path PK
        string type
        int size
        datetime modifiedAt
    }

    VERSION {
        int id PK
        string documentPath FK
        string content
        string hash
        datetime savedAt
    }

    USER ||--o{ BOOKMARK : creates
    BOOKMARK {
        int id PK
        string userId FK
        string documentPath FK
        int scrollPosition
        datetime createdAt
    }

    DOCUMENT ||--o{ BACKLINK : "linked from"
    BACKLINK {
        string sourcePath FK
        string targetPath FK
        int lineNumber
    }

    USER {
        string id PK
        string name
        string theme
        json preferences
    }
```

## Gantt Chart

```mermaid
gantt
    title DocView Development Roadmap
    dateFormat YYYY-MM-DD
    axisFormat %m/%d

    section Core
        Server implementation       :done, core1, 2025-01-01, 14d
        Markdown renderer          :done, core2, after core1, 10d
        File tree & navigation     :done, core3, after core1, 12d

    section Features
        Dark mode                  :done, feat1, after core2, 5d
        Live reload (SSE)          :done, feat2, after core2, 7d
        Full-text search           :done, feat3, after core3, 8d
        Tab management             :done, feat4, after core3, 6d

    section Advanced
        Mermaid diagrams           :done, adv1, after feat1, 5d
        KaTeX math                 :done, adv2, after adv1, 4d
        Split view                 :done, adv3, after feat4, 7d
        Backlinks                  :done, adv4, after feat3, 5d
        Image export               :active, adv5, after adv3, 6d

    section Quality
        E2E tests                  :active, qa1, after adv2, 10d
        Performance optimization   :qa2, after adv5, 8d
        Documentation              :qa3, after qa1, 7d
```

## Pie Chart

```mermaid
pie title Supported File Formats
    "Markdown" : 45
    "YAML" : 15
    "JSON" : 15
    "CSV" : 10
    "Images" : 10
    "Config files" : 5
```

## Git Graph

```mermaid
gitGraph
    commit id: "init"
    commit id: "server"
    branch feature/markdown
    checkout feature/markdown
    commit id: "markdown-it"
    commit id: "mermaid"
    commit id: "katex"
    checkout main
    branch feature/ui
    checkout feature/ui
    commit id: "file-tree"
    commit id: "tabs"
    commit id: "dark-mode"
    checkout main
    merge feature/markdown id: "merge-md"
    merge feature/ui id: "merge-ui"
    commit id: "search"
    branch feature/advanced
    commit id: "split-view"
    commit id: "backlinks"
    checkout main
    merge feature/advanced id: "v1.0"
    commit id: "release"
```

## Mindmap

```mermaid
mindmap
  root((DocView))
    Formats
      Markdown
        GFM
        Footnotes
        Front Matter
      Data
        YAML
        JSON
        CSV
      Config
        TOML
        INI
        ENV
      Images
        PNG/JPG
        SVG
        WebP
    Features
      Live Reload
      Dark Mode
      Search
        Full-text
        Regex
        Vim-style
      Navigation
        File Tree
        Tabs
        TOC
        Backlinks
    Rendering
      Mermaid
      KaTeX
      Highlight.js
      DOMPurify
```

## Timeline

```mermaid
timeline
    title DocView Release History
    2025-Q1 : Initial Release
             : Markdown rendering
             : File tree navigation
    2025-Q2 : Mermaid & KaTeX support
             : Dark mode
             : Live reload
    2025-Q3 : Full-text search
             : Tab management
             : Split view
    2025-Q4 : Backlinks
             : Image export
             : Regex search
             : Performance optimization
```

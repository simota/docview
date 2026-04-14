import { renderMarkdown, renderMermaidDiagrams, updateMermaidTheme } from './markdown';
import { initTheme, toggleTheme } from './theme';
import { FileTree } from './filetree';
import hljs from 'highlight.js';
import './style.css';

let currentFilePath: string | null = null;
let sidebarVisible = false;

const viewer = document.getElementById('viewer') as HTMLDivElement;
const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnSidebar = document.getElementById('btn-sidebar') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const sidebar = document.getElementById('sidebar') as HTMLElement;

// --- File type detection ---

const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);
const DATA_EXT = new Set(['.json', '.yaml', '.yml']);
const CONFIG_EXT = new Set(['.toml', '.ini', '.conf', '.env', '.cfg', '.properties']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);

type FileType = 'markdown' | 'data' | 'config' | 'image' | 'unknown';

function detectFileType(path: string): FileType {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (DATA_EXT.has(ext)) return 'data';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'unknown';
}

function langFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', ini: 'ini', conf: 'ini',
    env: 'bash', cfg: 'ini', properties: 'properties',
  };
  return map[ext] || 'plaintext';
}

// --- Rendering ---

function renderContent(content: string, path: string) {
  const type = detectFileType(path);

  switch (type) {
    case 'markdown':
      viewer.innerHTML = renderMarkdown(content);
      renderMermaidDiagrams();
      break;

    case 'data':
    case 'config': {
      let display = content;
      // Pretty-print JSON
      if (path.endsWith('.json')) {
        try {
          display = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          // keep original
        }
      }
      const lang = langFromExt(path);
      let highlighted: string;
      if (hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(display, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(display).value;
      }
      const ext = path.split('.').pop()?.toUpperCase() || '';
      viewer.innerHTML = `<div class="data-view"><span class="data-lang">${ext}</span><pre class="hljs"><code>${highlighted}</code></pre></div>`;
      break;
    }

    case 'image':
      // Images are loaded via server URL, not content
      break;

    default:
      viewer.innerHTML = `<pre class="hljs"><code>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  }
}

async function renderImage(path: string) {
  const url = `/api/file?path=${encodeURIComponent(path)}`;

  if (path.toLowerCase().endsWith('.svg')) {
    // Inline SVG for reliable rendering
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const svgText = await res.text();
      viewer.innerHTML = `<div class="image-view"><div class="svg-container">${svgText}</div><p class="image-caption">${path}</p></div>`;
      // Constrain the inline SVG
      const svgEl = viewer.querySelector('.svg-container svg') as SVGElement | null;
      if (svgEl) {
        svgEl.setAttribute('width', '100%');
        svgEl.removeAttribute('height');
        svgEl.style.maxHeight = '85vh';
      }
    } catch {
      viewer.innerHTML = `<div class="image-view"><p>Failed to load SVG</p></div>`;
    }
    return;
  }

  viewer.innerHTML = `<div class="image-view"><img src="${url}" alt="${path}" /><p class="image-caption">${path}</p></div>`;
}

function showWelcome() {
  viewer.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">D.</div>
      <h1>DocView</h1>
      <p>ドキュメント &amp; データファイルビューワー</p>
      <div class="welcome-formats">
        <span>Markdown</span><span>YAML</span><span>JSON</span>
        <span>TOML</span><span>INI</span><span>Images</span>
      </div>
      <p class="welcome-hint">サイドバーからファイルを選択、またはファイルをドラッグ＆ドロップ</p>
    </div>
  `;
}

// --- File loading ---

async function loadServerFile(path: string) {
  const type = detectFileType(path);
  currentFilePath = path;
  document.title = `${path} — DocView`;

  if (type === 'image') {
    renderImage(path);
    return;
  }

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) return;
    const content = await res.text();
    renderContent(content, path);
  } catch {
    // ignore
  }
}

async function reloadCurrentFile() {
  if (currentFilePath) {
    await loadServerFile(currentFilePath);
  }
}

function loadLocalFile(file: File) {
  const type = detectFileType(file.name);

  if (type === 'image') {
    const url = URL.createObjectURL(file);
    viewer.innerHTML = `<div class="image-view"><img src="${url}" alt="${file.name}" /><p class="image-caption">${file.name}</p></div>`;
    currentFilePath = null;
    document.title = `${file.name} — DocView`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    renderContent(reader.result as string, file.name);
    currentFilePath = null;
    document.title = `${file.name} — DocView`;
  };
  reader.readAsText(file);
}

// --- UI ---

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  sidebar.classList.toggle('sidebar-hidden', !sidebarVisible);
  btnSidebar.classList.toggle('toolbar-btn-active', sidebarVisible);
}

function openFile() {
  fileInput.click();
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loadLocalFile(file);
  input.value = '';
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) loadLocalFile(file);
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  document.body.classList.add('dragging');
}

function handleDragLeave() {
  document.body.classList.remove('dragging');
}

function handleKeyboard(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault();
    openFile();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
}

// --- SSE ---

function connectSSE() {
  const evtSource = new EventSource('/api/watch');
  evtSource.onmessage = (event) => {
    if (event.data === 'connected') return;
    try {
      const data = JSON.parse(event.data) as { event: string; path: string };
      if (data.event === 'change' && data.path === currentFilePath) {
        reloadCurrentFile();
      }
      if (data.event === 'add' || data.event === 'unlink') {
        fileTree?.refresh();
      }
    } catch { /* ignore */ }
  };
  evtSource.onerror = () => {
    evtSource.close();
    setTimeout(connectSSE, 3000);
  };
}

async function detectServerMode(): Promise<{ server: boolean; initialFile: string | null }> {
  try {
    const res = await fetch('/api/info');
    if (res.ok) {
      const data = await res.json();
      return { server: true, initialFile: data.initialFile || null };
    }
  } catch { /* not server mode */ }
  return { server: false, initialFile: null };
}

// --- Init ---

let fileTree: FileTree | null = null;

async function init() {
  const currentTheme = initTheme();
  updateMermaidTheme(currentTheme === 'dark');

  const { server: hasServer, initialFile } = await detectServerMode();

  if (hasServer) {
    fileTree = new FileTree(document.getElementById('filetree')!, (path) => {
      loadServerFile(path);
    });
    await fileTree.load();

    sidebarVisible = true;
    sidebar.classList.remove('sidebar-hidden');
    btnSidebar.classList.add('toolbar-btn-active');

    connectSSE();

    if (initialFile) {
      loadServerFile(initialFile);
      fileTree.setActive(initialFile);
    } else {
      const firstFile = sidebar.querySelector('.filetree-item[data-type="file"]') as HTMLElement;
      if (firstFile?.dataset.path) {
        loadServerFile(firstFile.dataset.path);
        fileTree.setActive(firstFile.dataset.path);
      } else {
        showWelcome();
      }
    }
  } else {
    sidebar.style.display = 'none';
    btnSidebar.style.display = 'none';
    showWelcome();
  }
}

init();

// Event listeners
btnTheme.addEventListener('click', () => {
  const newTheme = toggleTheme();
  updateMermaidTheme(newTheme === 'dark');
  if (currentFilePath) reloadCurrentFile();
});
btnOpen.addEventListener('click', openFile);
btnSidebar.addEventListener('click', toggleSidebar);
fileInput.addEventListener('change', handleFileSelect);
document.addEventListener('drop', handleDrop);
document.addEventListener('dragover', handleDragOver);
document.addEventListener('dragleave', handleDragLeave);
document.addEventListener('keydown', handleKeyboard);

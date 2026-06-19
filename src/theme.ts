export type Theme =
  | 'light'
  | 'dark'
  | 'paper'
  | 'whiteboard'
  | 'handwritten'
  | 'sakura'
  | 'matrix'
  | 'cyberpunk'
  | 'ascii'
  | 'origami'
  | 'brutalist'
  | 'newspaper'
  | 'sumi'
  | 'galaxy'
  | 'codex'
  | 'spotlight'
  | 'blueprint'
  | 'solarized'
  | 'tokyo'
  | 'aurora'
  | 'glass'
  | 'holo'
  | 'highcontrast'
  | 'ocean'
  | 'eink';

export const THEMES: readonly Theme[] = [
  'light',
  'dark',
  'paper',
  'whiteboard',
  'handwritten',
  'sakura',
  'matrix',
  'cyberpunk',
  'ascii',
  'origami',
  'brutalist',
  'newspaper',
  'sumi',
  'galaxy',
  'codex',
  'spotlight',
  'blueprint',
  'solarized',
  'tokyo',
  'aurora',
  'glass',
  'holo',
  'highcontrast',
  'ocean',
  'eink',
];

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  paper: 'Paper',
  whiteboard: 'Whiteboard',
  handwritten: 'Handwritten',
  sakura: 'Sakura',
  matrix: 'Matrix',
  cyberpunk: 'Cyberpunk',
  ascii: 'ASCII',
  origami: 'Origami',
  brutalist: 'Brutalist',
  newspaper: 'Newspaper',
  sumi: 'Sumi',
  galaxy: 'Galaxy',
  codex: 'Codex',
  spotlight: 'Spotlight',
  blueprint: 'Blueprint',
  solarized: 'Solarized',
  tokyo: 'Tokyo Night',
  aurora: 'Aurora',
  glass: 'Liquid Glass',
  holo: 'Holographic',
  highcontrast: 'High Contrast',
  ocean: 'Ocean',
  eink: 'E-Ink',
};

const STORAGE_KEY = 'md-viewer-theme';

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isValidTheme(v: string | null): v is Theme {
  return v != null && (THEMES as readonly string[]).includes(v);
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isValidTheme(stored) ? stored : getSystemTheme();
}

export function isDarkTheme(theme: Theme): boolean {
  return theme === 'dark';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
  updateIcon(theme);
  updateMenuActive(theme);
}

export function cycleTheme(): Theme {
  const current = getTheme();
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  setTheme(next);
  return next;
}

// Kept for call-site compatibility — cycles through all themes.
export function toggleTheme(): Theme {
  return cycleTheme();
}

function updateIcon(theme: Theme) {
  for (const t of THEMES) {
    const icon = document.getElementById(`icon-theme-${t}`);
    if (icon) (icon as HTMLElement).style.display = t === theme ? 'block' : 'none';
  }
}

function updateMenuActive(theme: Theme) {
  const menu = document.getElementById('theme-menu');
  if (!menu) return;
  menu.querySelectorAll<HTMLButtonElement>('[data-theme-value]').forEach((btn) => {
    const isActive = btn.dataset.themeValue === theme;
    btn.classList.toggle('theme-menu-item-active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

export function initTheme(): Theme {
  const theme = getTheme();
  setTheme(theme);
  return theme;
}

import cronstrue from 'cronstrue/i18n';
import { CronExpressionParser } from 'cron-parser';
import type { SecretMasker } from './secret-mask';

// 各ジョブで先読みする次回実行回数
const NEXT_RUN_COUNT = 3;

interface CronJob {
  line: number; // ソース上の 1-based 行番号(行ジャンプ用)
  schedule: string; // スケジュール式 ("0 3 * * *" / "@daily" / "@reboot")
  command: string; // 実行コマンド
  isReboot: boolean; // @reboot は時刻計算の対象外
}

interface CronEnv {
  line: number;
  name: string;
  value: string;
}

// 環境変数行: NAME=value (cron 行は時刻フィールドが数値/記号で始まるため衝突しない)
const ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
// @yearly などのエイリアス行 (@reboot は別扱い)
const ALIAS_RE = /^(@[A-Za-z]+)\s+(.+)$/;

function parseCrontab(content: string): { jobs: CronJob[]; envs: CronEnv[] } {
  const jobs: CronJob[] = [];
  const envs: CronEnv[] = [];

  content.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return; // 空行・コメント行はスキップ

    // @reboot: 起動時実行。cron-parser/cronstrue が解釈できないため特別扱い
    if (/^@reboot\b/.test(line)) {
      jobs.push({ line: lineNo, schedule: '@reboot', command: line.replace(/^@reboot\s*/, ''), isReboot: true });
      return;
    }

    // @daily などのエイリアス (cron-parser/cronstrue がそのまま解釈可能)
    const alias = line.match(ALIAS_RE);
    if (alias) {
      jobs.push({ line: lineNo, schedule: alias[1], command: alias[2], isReboot: false });
      return;
    }

    // 環境変数行
    const env = line.match(ENV_RE);
    if (env) {
      let value = env[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      envs.push({ line: lineNo, name: env[1], value });
      return;
    }

    // 標準の 5 フィールド + コマンド。
    // 注: /etc/crontab 形式 (6 番目が実行ユーザー) は特別扱いせず、ユーザー名はコマンド側に含めて表示する。
    const parts = line.split(/\s+/);
    if (parts.length >= 6) {
      jobs.push({ line: lineNo, schedule: parts.slice(0, 5).join(' '), command: parts.slice(5).join(' '), isReboot: false });
    } else {
      // 5 フィールド以下: コマンドなし、あるいは不正な行。スケジュールとしてそのまま解析を試みる。
      jobs.push({ line: lineNo, schedule: line, command: '', isReboot: false });
    }
  });

  return { jobs, envs };
}

// 1 日(0–23時)の実行時間帯。hours[h]=true なら h 時に発火する。
interface Timeline {
  hours: boolean[]; // 長さ 24
  perHour: number; // 稼働する各時あたりの発火回数(分フィールドの値数)
}

interface JobAnalysis {
  descJa: string;
  descEn: string;
  runsJst: string[]; // JST(Asia/Tokyo) で解釈・整形した次回実行
  runsUtc: string[]; // UTC で解釈・整形した次回実行
  timeline: Timeline | null; // 24時間タイムライン(解析不能・@reboot は null)
  valid: boolean;
}

// cron-parser が展開済みの時刻フィールドから 1 日の実行時間帯を求める。
// 曜日/日付ゲートには依存せず "1 日の中で何時に走るか" のみを表す。
function computeTimeline(schedule: string): Timeline | null {
  try {
    const e = CronExpressionParser.parse(schedule);
    const hours = new Array<boolean>(24).fill(false);
    for (const h of e.fields.hour.values) {
      if (h >= 0 && h < 24) hours[h] = true;
    }
    return { hours, perHour: e.fields.minute.values.length };
  } catch {
    return null;
  }
}

// スケジュールを指定タイムゾーンで解釈し、そのゾーンの壁時計で整形した次回実行を返す。
function computeRuns(schedule: string, now: Date, tz: string): string[] {
  const out: string[] = [];
  try {
    const it = CronExpressionParser.parse(schedule, { currentDate: now, tz });
    for (let i = 0; i < NEXT_RUN_COUNT && it.hasNext(); i++) {
      out.push(fmtInZone(it.next().toDate(), tz));
    }
  } catch {
    // 説明は出せても次回実行が計算できないケース(例: 過去日付など)は空のまま返す
  }
  return out;
}

function analyzeJob(job: CronJob, now: Date): JobAnalysis {
  if (job.isReboot) {
    return { descJa: 'システム起動時に実行', descEn: 'At system startup', runsJst: [], runsUtc: [], timeline: null, valid: true };
  }

  let descJa: string;
  let descEn: string;
  try {
    descJa = cronstrue.toString(job.schedule, { locale: 'ja', use24HourTimeFormat: true });
    descEn = cronstrue.toString(job.schedule, { locale: 'en', use24HourTimeFormat: true });
  } catch {
    return { descJa: '解析できないスケジュール', descEn: 'Unable to parse schedule', runsJst: [], runsUtc: [], timeline: null, valid: false };
  }

  return {
    descJa,
    descEn,
    runsJst: computeRuns(job.schedule, now, 'Asia/Tokyo'),
    runsUtc: computeRuns(job.schedule, now, 'UTC'),
    timeline: computeTimeline(job.schedule),
    valid: true,
  };
}

// 指定タイムゾーンの壁時計で "YYYY-MM-DD HH:mm" に整形する。
function fmtInZone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(',', '');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 稼働時間帯を "9–17時, 21時" のような範囲ラベルに整形する(ツールチップ用)。
function hourRangesLabel(hours: boolean[]): string {
  const ranges: string[] = [];
  let start = -1;
  for (let h = 0; h <= 24; h++) {
    const on = h < 24 && hours[h];
    if (on && start < 0) {
      start = h;
    } else if (!on && start >= 0) {
      ranges.push(start === h - 1 ? `${start}時` : `${start}–${h - 1}時`);
      start = -1;
    }
  }
  return ranges.join(', ');
}

// 1 時間あたりの発火回数を 0–1 の塗り強度(不透明度)に写像する。
function intensity(perHour: number): number {
  if (perHour >= 12) return 1;
  if (perHour >= 4) return 0.8;
  if (perHour >= 2) return 0.65;
  return 0.5;
}

// 24 セルのタイムライン HTML を生成する。
function renderTimeline(tl: Timeline | null): string {
  if (!tl) return '<span class="cron-tl-na">—</span>';
  const op = intensity(tl.perHour);
  const segs = tl.hours
    .map((on, h) =>
      on
        ? `<span class="cron-tl-seg active" data-h="${h}" style="opacity:${op}"></span>`
        : `<span class="cron-tl-seg" data-h="${h}"></span>`,
    )
    .join('');
  const label = `実行: ${hourRangesLabel(tl.hours)}（各時 ${tl.perHour} 回）`;
  return `<div class="cron-tl" title="${esc(label)}">
    <div class="cron-tl-bar" role="img" aria-label="${esc(label)}">${segs}</div>
    <div class="cron-tl-ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
  </div>`;
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// ファイル全体を曜日(0=日..6=土) × 時刻(0..23) で集計し、各セルの稼働ジョブ数を求める。
// 注: 曜日 × 時刻の "週内フットプリント" を表す近似。日付指定(dayOfMonth)のジョブは
// cron-parser 上 dayOfWeek が全曜日に展開されるため、全曜日に薄く現れる。
function computeHeatmap(jobs: CronJob[]): { grid: number[][]; max: number } | null {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const job of jobs) {
    if (job.isReboot) continue;
    try {
      const e = CronExpressionParser.parse(job.schedule);
      const dows = new Set<number>();
      for (const raw of e.fields.dayOfWeek.values) {
        const d = Number(raw);
        dows.add(d === 7 ? 0 : d); // 日曜は 0/7 両方で来るため正規化
      }
      for (const h of e.fields.hour.values) {
        if (h < 0 || h > 23) continue;
        for (const d of dows) {
          if (d < 0 || d > 6) continue;
          grid[d][h] += 1;
          if (grid[d][h] > max) max = grid[d][h];
        }
      }
    } catch {
      // 解析不能なジョブはヒートマップに含めない
    }
  }
  return max > 0 ? { grid, max } : null;
}

function renderHeatmap(jobs: CronJob[]): string {
  const hm = computeHeatmap(jobs);
  if (!hm) return '';
  const { grid, max } = hm;
  const rows = grid
    .map((row, d) => {
      const cells = row
        .map((count, h) => {
          if (count === 0) return `<span class="cron-hm-cell" data-d="${d}" data-h="${h}" data-level="0"></span>`;
          // ジョブ数を max 基準で 5 段階に正規化(少ない差も濃淡で区別できるよう細分化)
          const level = Math.min(5, Math.ceil((count / max) * 5));
          const label = `${DOW_LABELS[d]}曜 ${h}時: ${count} ジョブ`;
          return `<span class="cron-hm-cell active cron-hm-l${level}" data-d="${d}" data-h="${h}" data-level="${level}" title="${esc(label)}"></span>`;
        })
        .join('');
      return `<div class="cron-hm-row"><span class="cron-hm-day">${DOW_LABELS[d]}</span><div class="cron-hm-cells">${cells}</div></div>`;
    })
    .join('');
  const legend = `<span class="cron-hm-legend" aria-hidden="true">少<i class="cron-hm-sw cron-hm-l1"></i><i class="cron-hm-sw cron-hm-l2"></i><i class="cron-hm-sw cron-hm-l3"></i><i class="cron-hm-sw cron-hm-l4"></i><i class="cron-hm-sw cron-hm-l5"></i>多</span>`;
  return `<div class="cron-heatmap">
    <div class="cron-hm-head"><span>時間帯ヒートマップ <span class="cron-hm-sub">(曜日 × 時刻 · 色の濃さ = ジョブ数)</span></span>${legend}</div>
    ${rows}
    <div class="cron-hm-row cron-hm-axis"><span class="cron-hm-day"></span><div class="cron-hm-ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div></div>
  </div>`;
}

const FREQ_HORIZON_DAYS = 35; // 頻度・コリジョン算出の先読み期間
const FREQ_CAP = 1500; // 1 ジョブあたりの先読み上限(高頻度ジョブの暴走防止)
const DAY_MS = 86400000;

interface JobRuns {
  idx: number;
  job: CronJob;
  runs: Date[];
  perDay: number; // 1 日あたりの推定実行回数
}

// 各ジョブの今後 FREQ_HORIZON_DAYS 日分の実行時刻を先読みし、1 日あたり頻度を推定する。
function gatherRuns(jobs: CronJob[], now: Date): JobRuns[] {
  const horizon = now.getTime() + FREQ_HORIZON_DAYS * DAY_MS;
  return jobs.map((job, idx) => {
    if (job.isReboot) return { idx, job, runs: [], perDay: 0 };
    const runs: Date[] = [];
    try {
      const it = CronExpressionParser.parse(job.schedule, { currentDate: now });
      while (runs.length < FREQ_CAP && it.hasNext()) {
        const d = it.next().toDate();
        if (d.getTime() > horizon) break;
        runs.push(d);
      }
    } catch {
      // 解析不能なジョブは頻度 0
    }
    const capped = runs.length === FREQ_CAP;
    let perDay = 0;
    if (runs.length) {
      if (capped) {
        // 上限到達(高頻度): 実際にカバーした期間で割って正確なレートを出す
        const covered = Math.max((runs[runs.length - 1].getTime() - now.getTime()) / DAY_MS, 1 / 24);
        perDay = runs.length / covered;
      } else {
        // 期間全体をカバー: 固定の期間で割る(まれなジョブの過大評価を防ぐ)
        perDay = runs.length / FREQ_HORIZON_DAYS;
      }
    }
    return { idx, job, runs, perDay };
  });
}

interface Collision {
  time: Date;
  idxs: number[];
}

// 同一分(同じ壁時計の分)に複数ジョブが重なるインスタントを検出する。
function findCollisions(jr: JobRuns[]): Collision[] {
  const map = new Map<number, Set<number>>();
  for (const r of jr) {
    for (const d of r.runs) {
      const key = Math.floor(d.getTime() / 60000);
      let s = map.get(key);
      if (!s) {
        s = new Set<number>();
        map.set(key, s);
      }
      s.add(r.idx);
    }
  }
  const cols: Collision[] = [];
  for (const [key, s] of map) {
    if (s.size >= 2) cols.push({ time: new Date(key * 60000), idxs: [...s].sort((a, b) => a - b) });
  }
  cols.sort((a, b) => a.time.getTime() - b.time.getTime());
  return cols;
}

function fmtNum(v: number): string {
  if (v >= 10) return String(Math.round(v));
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function freqLabel(perDay: number): string {
  if (perDay >= 1) return `${fmtNum(perDay)} 回/日`;
  const perWeek = perDay * 7;
  if (perWeek >= 1) return `${fmtNum(perWeek)} 回/週`;
  return `約${fmtNum(perDay * 30)} 回/月`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function jobLabel(job: CronJob, maskValue?: SecretMasker): string {
  const cmd = job.command ? (maskValue ? maskValue(job.command, '') : job.command) : '';
  return cmd ? truncate(cmd, 32) : job.schedule;
}

function renderFrequency(jr: JobRuns[]): string {
  const ranked = jr.filter((r) => !r.job.isReboot && r.perDay > 0).sort((a, b) => b.perDay - a.perDay);
  if (!ranked.length) return '';
  const maxPerDay = ranked[0].perDay;
  const rows = ranked
    .map((r) => {
      const w = Math.max(2, (r.perDay / maxPerDay) * 100);
      return `<div class="cron-freq-row">
        <code class="cron-freq-sched">${esc(r.job.schedule)}</code>
        <div class="cron-freq-bar-wrap"><div class="cron-freq-bar" style="width:${w.toFixed(1)}%"></div></div>
        <span class="cron-freq-val">${esc(freqLabel(r.perDay))}</span>
      </div>`;
    })
    .join('');
  return `<div class="cron-freq">
    <div class="cron-freq-head">実行頻度 <span class="cron-freq-sub">(多い順)</span></div>
    ${rows}
  </div>`;
}

function renderCollisions(jr: JobRuns[], maskValue?: SecretMasker): string {
  const cols = findCollisions(jr);
  if (!cols.length) {
    return `<div class="cron-collide cron-collide--ok">同時刻に重なるジョブはありません（今後 ${FREQ_HORIZON_DAYS} 日間）</div>`;
  }
  const MAX = 8;
  const items = cols
    .slice(0, MAX)
    .map((c) => {
      const jobs = c.idxs.map((i) => esc(jobLabel(jr[i].job, maskValue))).join(' / ');
      return `<li><span class="cron-col-time">${fmtInZone(c.time, 'Asia/Tokyo')}</span><span class="cron-col-count">${c.idxs.length}ジョブ</span><span class="cron-col-jobs">${jobs}</span></li>`;
    })
    .join('');
  const more = cols.length > MAX ? `<li class="cron-col-more">ほか ${cols.length - MAX} 件</li>` : '';
  return `<div class="cron-collide cron-collide--warn">
    <div class="cron-collide-head">⚠ 同時実行の重複 <span class="cron-collide-sub">(${cols.length} 件 · 今後 ${FREQ_HORIZON_DAYS} 日間 · JST)</span></div>
    <ul class="cron-col-list">${items}${more}</ul>
  </div>`;
}

export function renderCronTable(content: string, path: string, maskValue?: SecretMasker): string {
  const { jobs, envs } = parseCrontab(content);

  if (!jobs.length && !envs.length) {
    return `<p class="error-banner">No cron entries found in ${esc(path)}</p>`;
  }

  const now = new Date();
  const runs = gatherRuns(jobs, now);

  const envHtml = envs.length
    ? `<div class="cron-env">
        <div class="cron-env-title">環境変数</div>
        <ul class="cron-env-list">
          ${envs
            .map((e) => {
              const v = maskValue ? maskValue(e.value, e.name) : e.value;
              return `<li data-line="${e.line}"><span class="cron-env-name">${esc(e.name)}</span><span class="cron-env-eq">=</span><span class="cron-env-val">${esc(v)}</span></li>`;
            })
            .join('')}
        </ul>
      </div>`
    : '';

  const rows = jobs
    .map((job) => {
      const a = analyzeJob(job, now);
      const renderRuns = (runs: string[]) =>
        runs.length
          ? runs.map((r) => `<div class="cron-next-item">${r}</div>`).join('')
          : '<span class="cron-next-na">—</span>';
      const runsHtml = job.isReboot
        ? '<span class="cron-next-na">—</span>'
        : `<span class="cron-next-jst">${renderRuns(a.runsJst)}</span><span class="cron-next-utc">${renderRuns(a.runsUtc)}</span>`;
      const cmd = job.command ? (maskValue ? maskValue(job.command, '') : job.command) : '';
      const cmdHtml = cmd ? `<code>${esc(cmd)}</code>` : '<span class="cron-empty">—</span>';
      const rowClass = a.valid ? '' : ' class="cron-invalid"';
      const timelineHtml = job.isReboot ? '<span class="cron-tl-na">—</span>' : renderTimeline(a.timeline);
      return `<tr data-line="${job.line}"${rowClass}>
        <td class="cron-line-num">${job.line}</td>
        <td class="cron-sched"><code>${esc(job.schedule)}</code></td>
        <td class="cron-tl-cell">${timelineHtml}</td>
        <td class="cron-desc"><span class="cron-desc-ja">${esc(a.descJa)}</span><span class="cron-desc-en">${esc(a.descEn)}</span></td>
        <td class="cron-next">${runsHtml}</td>
        <td class="cron-cmd">${cmdHtml}</td>
      </tr>`;
    })
    .join('');

  const tableHtml = jobs.length
    ? `<div class="cron-table-wrap">
        <table class="cron-table">
          <thead><tr>
            <th class="cron-line-num-header" aria-label="行番号">#</th>
            <th>スケジュール</th>
            <th>実行時間帯 <span class="cron-tl-axis-note">0–24h</span></th>
            <th>説明</th>
            <th>次回実行 <span class="cron-tz-label"></span></th>
            <th>コマンド</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    : '';

  return `<div class="cron-view" data-lang="ja" data-tz="jst">
    <div class="cron-info">
      <span>${jobs.length} ジョブ${envs.length ? ` &middot; ${envs.length} 環境変数` : ''}</span>
      <span class="cron-toggles">
        <span class="cron-tz-toggle" role="group" aria-label="次回実行のタイムゾーン">
          <button class="cron-tz-btn active" data-tz="jst">JST</button>
          <button class="cron-tz-btn" data-tz="utc">UTC</button>
        </span>
        <span class="cron-lang-toggle" role="group" aria-label="説明の言語">
          <button class="cron-lang-btn active" data-lang="ja">日本語</button>
          <button class="cron-lang-btn" data-lang="en">English</button>
        </span>
      </span>
    </div>
    ${envHtml}
    ${renderHeatmap(jobs)}
    ${renderCollisions(runs, maskValue)}
    ${renderFrequency(runs)}
    ${tableHtml}
  </div>`;
}

// 説明文の言語(ja/en)と次回実行のタイムゾーン(jst/utc)のトグル。
// csv-viewer と同様にドキュメントレベルの委譲で 1 度だけ登録する。
export function initCronToggles(): void {
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;

    const langBtn = el.closest('.cron-lang-btn');
    if (langBtn) {
      const view = langBtn.closest('.cron-view') as HTMLElement | null;
      if (!view) return;
      const lang = (langBtn as HTMLElement).dataset.lang === 'en' ? 'en' : 'ja';
      view.dataset.lang = lang;
      view.querySelectorAll('.cron-lang-btn').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.lang === lang),
      );
      return;
    }

    const tzBtn = el.closest('.cron-tz-btn');
    if (tzBtn) {
      const view = tzBtn.closest('.cron-view') as HTMLElement | null;
      if (!view) return;
      const tz = (tzBtn as HTMLElement).dataset.tz === 'utc' ? 'utc' : 'jst';
      view.dataset.tz = tz;
      view.querySelectorAll('.cron-tz-btn').forEach((b) =>
        b.classList.toggle('active', (b as HTMLElement).dataset.tz === tz),
      );
    }
  });
}

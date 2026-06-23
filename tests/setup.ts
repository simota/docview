import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

// Minimal valid 1×1 PNG (67 bytes) for album fixture images.
// Generated from the canonical 1x1 transparent PNG binary.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
  '890000000a49444154789c6260000000020001e221bc330000000049454e44ae' +
  '426082',
  'hex',
);

// Minimal valid 1×1 red JPEG (631 bytes approximation via raw JFIF).
// We use the same tiny PNG for .jpg since the server only checks the
// extension — the browser never loads these images in headless tests.
const TINY_JPG = TINY_PNG;

// Minimal SVG image.
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const PORTRAIT_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="240" viewBox="0 0 80 240">',
  '<rect width="80" height="240" fill="#f97316"/>',
  '<circle cx="40" cy="40" r="24" fill="#fff7ed"/>',
  '<rect x="18" y="92" width="44" height="112" rx="10" fill="#7c2d12"/>',
  '</svg>',
].join('');
const LANDSCAPE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80">',
  '<rect width="240" height="80" fill="#0ea5e9"/>',
  '<circle cx="48" cy="40" r="24" fill="#e0f2fe"/>',
  '<rect x="96" y="24" width="104" height="32" rx="8" fill="#075985"/>',
  '</svg>',
].join('');

// Minimal valid MP4 (146 bytes): ftyp(isom/mp41) + moov(mvhd only) + mdat(empty).
// Constructed to satisfy ISO Base Media File Format requirements just enough for
// the server to serve it with Accept-Ranges and for the browser to instantiate
// a <video> element. Actual playback is not required for E2E tests.
// Generated via Python struct: ftyp(24 bytes) + moov(114 bytes) + mdat(8 bytes) = 146 bytes.
const TINY_MP4 = Buffer.from(
  '000000186674797069736f6d0000020069736f6d6d703431' +
  '000000726d6f6f760000006a6d766864000000000000000000000000000003e8' +
  '00000000000100000100000000000000000000010000000000000000000000000000000100000000000000000000000000004000' +
  '000000000000000000000000000000000000000000000000000000000000000002' +
  '000000086d646174',
  'hex',
);

/**
 * Global Playwright setup — materializes the fixture directory that the
 * auto-started server reads from. Kept here so tests are self-contained
 * and reproducible on fresh machines.
 */
const DIR = '/tmp/md-test-docs';

function write(name: string, body: string) {
  writeFileSync(join(DIR, name), body);
}

export default async function globalSetup() {
  mkdirSync(DIR, { recursive: true });

  write('README.md', '# Hello DocView\n\nSample markdown for E2E tests.\n');

  write('config.yaml', 'name: docview\nversion: 1.0.0\nfeatures:\n  - search\n  - live-reload\n');

  write('data.json', JSON.stringify({ name: 'docview', keywords: ['markdown', 'yaml'] }, null, 2) + '\n');

  write('secrets.json', JSON.stringify({
    service: 'docview',
    apiKey: 'dv_live_ABC1234567890SECRETKEY',
    nested: { client_secret: 'client-secret-value-1234567890' },
    digest: '0123456789abcdef0123456789abcdef',
  }, null, 2) + '\n');

  write('secrets.yaml', 'name: docview\npassword: super-secret-password\ntoken: tok_ABC1234567890SECRET\n');

  write('secrets.env', 'PUBLIC_NAME=docview\nAPI_KEY=dv_live_ABC1234567890SECRETKEY\nAUTHORIZATION=Bearer abcdef1234567890TOKEN\n');

  write('secrets.csv', 'name,api_key,notes\nAlice,dv_live_ABC1234567890SECRETKEY,public note\n');

  write('secrets.md', '# Secret Notes\n\nAPI_KEY=dv_live_ABC1234567890SECRETKEY\n\nAuthorization: Bearer abcdef1234567890TOKEN\n');

  // Plain-text .ini for line-jump tests (renderHighlighted path).
  const iniLines: string[] = [];
  for (let i = 1; i <= 80; i++) iniLines.push(`entry${i}=value_${i}`);
  write('settings.ini', iniLines.join('\n') + '\n');

  // .log falling through to plain-text (unknown format) — also renderHighlighted.
  const logLines: string[] = [];
  for (let i = 1; i <= 50; i++) {
    logLines.push(`2025-01-01 12:00:${String(i).padStart(2, '0')} INFO line number ${i} event`);
  }
  logLines[24] = `2025-01-01 12:00:25 ERROR target line number 25 — this is the one to share`;
  write('app.log', logLines.join('\n') + '\n');

  // Regression fixture: filename with a literal `%` — verifies parseHash does
  // not double-decode URL escapes (codex review P1).
  write('100%.ini', 'percent=one\nliteral=two\n');

  // CSV for row-number and sort tests.
  write('sample.csv', 'name,score\nAlice,90\nBob,80\nCarol,70\n');

  // Slides fixture for Cmd+Shift+S regression test.
  write('slides.md', '# Slide 1\n\nfirst slide\n\n---\n\n# Slide 2\n\nsecond slide\n');

  // Marp deck fixture: front matter `marp: true` enables the faithful slide presenter.
  write(
    'marp-deck.md',
    '---\nmarp: true\ntheme: gaia\npaginate: true\n---\n\n# Marp Title\n\nintro slide\n\n---\n\n## Second slide\n\n- a\n- b\n\n---\n\n## Third slide\n\nthe end\n',
  );

  write('diagrams.md', `# Diagram gallery

\`\`\`mermaid
flowchart TD
  Start[Open DocView] --> Compare[Compare two files]
  Compare --> Review[Review the diff]
\`\`\`
`);

  // Standalone Mermaid source file — should render the diagram directly.
  write('flow.mmd', 'flowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[NG]\n');

  // Small JSONL for the non-chunked table tests (row numbers, jump, invalid-line
  // skip). 10 valid objects with one invalid line in the middle.
  const smallJsonl: string[] = [];
  for (let i = 1; i <= 5; i++) {
    smallJsonl.push(JSON.stringify({ id: i, name: `event-${i}`, status: i % 2 ? 'ok' : 'warn' }));
  }
  smallJsonl.push('this is not valid json — should be skipped');
  for (let i = 6; i <= 10; i++) {
    smallJsonl.push(JSON.stringify({ id: i, name: `event-${i}`, status: i % 2 ? 'ok' : 'warn' }));
  }
  write('events-small.jsonl', smallJsonl.join('\n') + '\n');

  // Large JSONL (>5MB) to exercise the chunked/paginated table (PAGE_SIZE=1000).
  // ~150k rows × ~60 bytes ≈ 9MB, above the 5MB CHUNK_THRESHOLD → 150 pages.
  const bigJsonl: string[] = [];
  for (let i = 1; i <= 150000; i++) {
    bigJsonl.push(JSON.stringify({ id: i, name: `event-${i}`, status: i % 2 ? 'ok' : 'warn', note: `row ${i} payload` }));
  }
  write('events.jsonl', bigJsonl.join('\n') + '\n');

  // HTML fixture for the sandboxed-iframe HTML view. The inline <script>
  // appends #js-ran so tests can assert it does NOT run while sandboxed (default)
  // and DOES run after the scripts toggle is enabled.
  write('page.html', [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><style>.box{color:#c00}</style></head>',
    '<body>',
    '<h1 id="hello">Hello HTML</h1>',
    '<p class="box">Sandboxed preview content.</p>',
    '<script>var d=document.createElement("div");d.id="js-ran";d.textContent="js executed";document.body.appendChild(d);</script>',
    '</body></html>',
  ].join('\n'));

  mkdirSync('/tmp/md-test-docs/html-assets', { recursive: true });
  writeFileSync('/tmp/md-test-docs/html-assets/theme.css', [
    '#linked-style-target {',
    '  color: rgb(14, 116, 144);',
    '  background-image: url("./badge.svg");',
    '}',
  ].join('\n'));
  writeFileSync('/tmp/md-test-docs/html-assets/badge.svg', [
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">',
    '<rect width="4" height="4" fill="#0e7490"/>',
    '</svg>',
  ].join(''));
  writeFileSync('/tmp/md-test-docs/html-assets/inline-badge.svg', [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">',
    '<rect width="24" height="24" fill="#0ea5e9"/>',
    '</svg>',
  ].join(''));
  write('page-with-assets.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<link rel="stylesheet" href="./html-assets/theme.css">',
    '</head>',
    '<body>',
    '<div id="linked-style-target">Styled by linked CSS</div>',
    '</body>',
    '</html>',
  ].join('\n'));
  write('page-with-external-style.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<link rel="stylesheet" href="http://127.0.0.1:4090/preview-style.css">',
    '</head>',
    '<body>',
    '<div id="external-style-target">Styled by external CSS</div>',
    '</body>',
    '</html>',
  ].join('\n'));
  write('page-with-external-script.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '</head>',
    '<body>',
    '<div id="external-script-target">Styled by external script</div>',
    '<script src="http://127.0.0.1:4090/preview-script.js"></script>',
    '</body>',
    '</html>',
  ].join('\n'));
  write('html-assets/relative.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<body>',
    '<h1 id="asset-title">Relative asset fixture</h1>',
    '<img id="relative-badge" src="inline-badge.svg" width="24" height="24" alt="relative badge">',
    '</body>',
    '</html>',
  ].join('\n'));

  // Nested directory files for tab disambiguation test.
  mkdirSync('/tmp/md-test-docs/subdir', { recursive: true });
  writeFileSync('/tmp/md-test-docs/subdir/README.md', '# Subdir Readme\n\nThis is the subdir readme.\n');

  // ---- Ignore-aware scoping fixtures ----
  // Built-in ignored build/dependency dirs — their contents must NEVER appear
  // in the tree or search results, even though the files have supported exts.
  for (const d of ['dist', 'vendor', 'coverage', 'node_modules']) {
    mkdirSync(join(DIR, d), { recursive: true });
    writeFileSync(join(DIR, d, 'artifact.md'), `# ${d}\n\nIGNOREDBUILDARTIFACT token in ${d}.\n`);
  }
  // Hidden dotfile that MUST stay visible (.env is in SUPPORTED_EXTENSIONS).
  write('.env', 'PUBLIC_NAME=docview\nVISIBLE_DOTENV_TOKEN=shown\n');
  // .docviewignore (gitignore-style) — user-defined exclusions.
  write('.docviewignore', '# DocView ignore fixture\ncustom-ignored\nignore-me.md\n');
  mkdirSync(join(DIR, 'custom-ignored'), { recursive: true });
  writeFileSync(join(DIR, 'custom-ignored', 'note.md'), '# custom\n\nCUSTOMIGNORED token.\n');
  write('ignore-me.md', '# ignore me\n\nIGNOREMEFILE token.\n');

  // ---- Album view fixtures ----
  // images/ — 3 direct images for grid rendering tests.
  mkdirSync('/tmp/md-test-docs/images', { recursive: true });
  writeFileSync('/tmp/md-test-docs/images/a.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/images/b.jpg', TINY_JPG);
  writeFileSync('/tmp/md-test-docs/images/c.svg', TINY_SVG);

  // images/nested/ — 1 extra image for recursive scan test.
  // Kept under images/ so it does not pollute the global file-search autocomplete
  // used by url-bar.spec.ts (which searches for 'sub' and expects subdir/README.md
  // to be the first candidate).
  mkdirSync('/tmp/md-test-docs/images/nested', { recursive: true });
  writeFileSync('/tmp/md-test-docs/images/nested/d.png', TINY_PNG);

  // Remove stale subdir/d.png that an earlier setup iteration may have created.
  // Leaving it would pollute url-bar autocomplete ('sub' search returns d.png first).
  rmSync('/tmp/md-test-docs/subdir/d.png', { force: true });

  // empty-dir/ — 0 images for the "no images" message test.
  // Note: buildTree excludes empty directories from the file tree, so this
  // directory only appears in album API tests, not in filetree UI tests.
  mkdirSync('/tmp/md-test-docs/empty-dir', { recursive: true });
  writeFileSync('/tmp/md-test-docs/empty-dir/.gitkeep', '');

  // gallery4/ — 4 direct images for compare-grid 4-pane tests.
  // Kept separate from images/ to avoid breaking existing album tests that
  // assume images/ has exactly 3 direct images.
  mkdirSync('/tmp/md-test-docs/gallery4', { recursive: true });
  writeFileSync('/tmp/md-test-docs/gallery4/g1.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/gallery4/g2.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/gallery4/g3.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/gallery4/g4.png', TINY_PNG);

  // compare-special/ — filenames that exercise compare hash parsing.
  mkdirSync('/tmp/md-test-docs/compare-special', { recursive: true });
  writeFileSync('/tmp/md-test-docs/compare-special/foo,bar.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/compare-special/100%.png', TINY_PNG);

  // gallery-many/ — 6 images to verify selection cap removal for Download/Print.
  mkdirSync('/tmp/md-test-docs/gallery-many', { recursive: true });
  for (let i = 1; i <= 6; i++) {
    writeFileSync(`/tmp/md-test-docs/gallery-many/m${i}.png`, TINY_PNG);
  }

  // aspect-ratio/ — portrait and landscape images for tile fit regression tests.
  mkdirSync('/tmp/md-test-docs/aspect-ratio', { recursive: true });
  writeFileSync('/tmp/md-test-docs/aspect-ratio/landscape.svg', LANDSCAPE_SVG);
  writeFileSync('/tmp/md-test-docs/aspect-ratio/portrait.svg', PORTRAIT_SVG);

  // Apache-style combined access log with one unparseable line in the middle.
  // Used to verify the log table's `#` column uses the original file-line
  // number, not the parsed-entries index (codex review P2).
  const apacheLines = [
    '127.0.0.1 - - [01/Jan/2025:12:00:01 +0000] "GET / HTTP/1.1" 200 1234 "-" "curl/8"',
    '127.0.0.1 - - [01/Jan/2025:12:00:02 +0000] "GET /a HTTP/1.1" 200 4567 "-" "curl/8"',
    'this line is not a valid apache log entry and should be skipped',
    '127.0.0.1 - - [01/Jan/2025:12:00:04 +0000] "GET /b HTTP/1.1" 404 0 "-" "curl/8"',
    '127.0.0.1 - - [01/Jan/2025:12:00:05 +0000] "GET /c HTTP/1.1" 500 321 "-" "curl/8"',
  ];
  write('access.log', apacheLines.join('\n') + '\n');

  // Laravel application log fixture: mix of single-line JSON entries, plain
  // text DEBUG, and a multi-line var_dump-style INFO that the parser must
  // group into a single entry.
  const laravelLines = [
    `[2026-05-21 11:36:17] local.INFO: {"user_id":null,"url":"/","method":"GET","status":302,"request_id":"abc"}`,
    `[2026-05-21 11:36:22] local.DEBUG: SHA256Hasher::make hello -> 0123abcd`,
    `[2026-05-21 11:36:30] local.INFO: `,
    `-> Entering step init, name 'idempotency_auto_fill'`,
    `---------------------------------------------------`,
    `  command was set to array(1) { ["name"]=> string(7) "GetItem" }`,
    `[2026-05-21 11:36:45] local.ERROR: Error executing GetItem {"userId":42,"exception":"Stub"}`,
  ];
  write('laravel.log', laravelLines.join('\n') + '\n');

  // ---- Crontab viewer fixtures ----
  // .crontab file exercising: comments, env vars, standard 5-field jobs,
  // an @alias, an @reboot job, and an invalid schedule.
  const crontabLines = [
    '# DocView E2E crontab fixture',
    'SHELL=/bin/bash',
    'MAILTO=ops@example.com',
    '',
    '# daily backup at 03:00',
    '0 3 * * * /usr/local/bin/backup.sh',
    '',
    '# weekday health check every 15 minutes',
    '*/15 9-17 * * 1-5 /opt/healthcheck.sh',
    '',
    '# weekly log rotation',
    '@weekly /usr/sbin/logrotate /etc/logrotate.conf',
    '',
    '# run on system reboot',
    '@reboot /opt/startup.sh',
    '',
    '# invalid schedule (should be flagged)',
    '99 99 * * * /bin/false',
  ];
  write('tasks.crontab', crontabLines.join('\n') + '\n');

  // Extension-less `crontab` file — detected by filename, not extension.
  write('crontab', 'MAILTO=root\n0 0 1 * * /usr/local/bin/monthly.sh\n');

  // Heatmap density fixture: overlapping schedules so Monday 9h accumulates
  // 3 jobs (max) while Tue–Fri 9h have 1 — exercises graduated shading levels.
  // Also has distinct minutes (:00 / :30 / :45) so no same-minute collisions.
  write('dense.crontab', [
    '0 9 * * 1-5 /opt/a.sh',
    '30 9 * * 1 /opt/b.sh',
    '45 9 * * 1 /opt/c.sh',
  ].join('\n') + '\n');

  // Collision fixture: three jobs all fire at 12:00 (weekdays → 3-way collision).
  write('collide.crontab', [
    '0 12 * * * /opt/daily-noon.sh',
    '0 12 * * 1-5 /opt/weekday-noon.sh',
    '*/30 * * * * /opt/every-30min.sh',
  ].join('\n') + '\n');

  // ---- Video support Phase 1 fixtures ----

  // videos/ — video-only directory: 2 mp4 files + 1 mkv (excluded from gallery).
  mkdirSync('/tmp/md-test-docs/videos', { recursive: true });
  writeFileSync('/tmp/md-test-docs/videos/clip1.mp4', TINY_MP4);
  writeFileSync('/tmp/md-test-docs/videos/clip2.mp4', TINY_MP4);
  // notes.mkv: mkv is intentionally unsupported — must NOT appear in /api/gallery.
  writeFileSync('/tmp/md-test-docs/videos/notes.mkv', Buffer.from('0x1a45dfa3', 'utf-8'));

  // mixed/ — directory with both image and video files.
  mkdirSync('/tmp/md-test-docs/mixed', { recursive: true });
  writeFileSync('/tmp/md-test-docs/mixed/photo1.png', TINY_PNG);
  writeFileSync('/tmp/md-test-docs/mixed/clip3.mp4', TINY_MP4);

  // ---- Regression fixtures (regression.spec.ts) ----
  // Pre-create the live-reload fixture so the in-test rewrite emits `change`
  // (file-local reload) instead of `add` (global tree refresh in every page),
  // keeping cross-test interference minimal.
  write('live-reload.md', '# Live Reload v1\n');

  // Filename containing an HTML injection payload — the breadcrumb must
  // escape path segments instead of injecting an <img> element.
  write('<img src=x onerror=window.__xss=1>.md', '# XSS filename fixture\n');

  // Wiki links with dangerous URL schemes must render as plain text,
  // while normal wiki links keep working.
  write('wiki.md', [
    '# Wiki Links',
    '',
    'Safe: [[README]]',
    '',
    'Evil: [[javascript:alert(1)]] and [[data:text/html;base64,PHNjcmlwdD4=]]',
  ].join('\n') + '\n');

  // mtime filter fixtures (filetree-mtime-filter.spec.ts).
  // archived-old.md: backdated ~400 days → excluded by every preset except "すべて".
  // edited-yesterday.md: dated to yesterday noon → excluded by "今日" but included
  //   from "昨日" onward. The fresh fixtures above all stay within "今日".
  write('archived-old.md', '# Archived\n\nOld document for the mtime filter test.\n');
  const oldTime = new Date(Date.now() - 400 * 86_400_000);
  utimesSync(join(DIR, 'archived-old.md'), oldTime, oldTime);

  write('edited-yesterday.md', '# Yesterday\n\nDocument from yesterday for the mtime filter test.\n');
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayNoon = new Date(todayStart.getTime() - 12 * 3_600_000); // always yesterday 12:00
  utimesSync(join(DIR, 'edited-yesterday.md'), yesterdayNoon, yesterdayNoon);
}

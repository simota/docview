import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

  // Nested directory files for tab disambiguation test.
  mkdirSync('/tmp/md-test-docs/subdir', { recursive: true });
  writeFileSync('/tmp/md-test-docs/subdir/README.md', '# Subdir Readme\n\nThis is the subdir readme.\n');

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
}

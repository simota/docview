import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

  write('diagrams.md', `# Diagram gallery

\`\`\`mermaid
flowchart TD
  Start[Open DocView] --> Compare[Compare two files]
  Compare --> Review[Review the diff]
\`\`\`
`);

  // Nested directory files for tab disambiguation test.
  mkdirSync('/tmp/md-test-docs/subdir', { recursive: true });
  writeFileSync('/tmp/md-test-docs/subdir/README.md', '# Subdir Readme\n\nThis is the subdir readme.\n');

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
}

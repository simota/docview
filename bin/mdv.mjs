#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const args = process.argv.slice(2);

// Help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  ${pkg.name} v${pkg.version}
  ${pkg.description}

  Usage:
    docview [path] [options]
    mdv [path] [options]

  Arguments:
    path               File or directory to view (default: current directory)

  Options:
    -p, --port <port>  Port number (default: 4000)
    --no-open          Don't auto-open browser
    -h, --help         Show this help
    -v, --version      Show version

  Supported formats:
    Markdown   .md .markdown .mdx .txt
    Data       .json .yaml .yml
    Config     .toml .ini .conf .env .cfg .properties
    Images     .png .jpg .jpeg .gif .svg .webp .bmp .ico

  Examples:
    docview                  # View current directory
    docview ./docs           # View ./docs directory
    docview README.md        # Open specific file
    mdv config.yaml -p 8080  # Custom port
`);
  process.exit(0);
}

// Version
if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

// Parse args for --no-open
const noOpen = args.includes('--no-open');
const filteredArgs = args.filter((a) => a !== '--no-open');

// Auto-open browser after server starts
const serverPath = join(__dirname, '..', 'server.mjs');

// Determine port from args
let port = 4000;
for (let i = 0; i < filteredArgs.length; i++) {
  if (filteredArgs[i] === '--port' || filteredArgs[i] === '-p') {
    port = parseInt(filteredArgs[i + 1], 10) || 4000;
  }
}

// Import and start server
async function main() {
  // Dynamic import of the server — it self-starts on import
  await import(serverPath);

  if (!noOpen) {
    const url = `http://localhost:${port}/`;
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

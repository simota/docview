#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, fork } from 'node:child_process';

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

// Start server as a child process to detect the actual port

const child = fork(serverPath, filteredArgs, { stdio: ['inherit', 'pipe', 'inherit', 'ipc'] });

child.stdout.on('data', (data) => {
  process.stdout.write(data);
  const match = data.toString().match(/localhost:(\d+)/);
  if (match && !noOpen) {
    const actualPort = match[1];
    const url = `http://localhost:${actualPort}/`;
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execFile(cmd, [url], () => {});
  }
});

child.on('exit', (code) => process.exit(code ?? 0));

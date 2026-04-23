import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  globalSetup: './tests/setup.ts',
  use: {
    baseURL: 'http://localhost:4001',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    // Primary DocView under test — remote enabled + private IPs allowed so
    // the mock server on 127.0.0.1 can be reached end-to-end.
    {
      command: 'node server.mjs /tmp/md-test-docs --port 4001 --allow-private-remote',
      cwd: __dirname,
      url: 'http://localhost:4001',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    // Secondary DocView — default security (private IPs refused). Used to
    // verify SSRF guards reject loopback targets when not opted in.
    {
      command: 'node server.mjs /tmp/md-test-docs --port 4002',
      cwd: __dirname,
      url: 'http://localhost:4002',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    // Mock remote target — serves markdown, html, and unsupported files so
    // whitelist / deny behavior can be exercised deterministically.
    {
      command: 'node tests/mock-remote-server.mjs --port 4090',
      cwd: __dirname,
      url: 'http://127.0.0.1:4090/health',
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
  ],
});

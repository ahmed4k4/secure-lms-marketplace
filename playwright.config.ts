import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL },
  // Starts the production server when none is running. Requires `npm run build` first and a populated .env.local.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run start', url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 60_000 },
});

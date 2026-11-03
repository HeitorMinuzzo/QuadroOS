import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx tests/browser/server.ts',
      url: 'http://127.0.0.1:3002/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { PORT: '3002', DATA_DIR: 'memory://', APP_ORIGIN: 'http://127.0.0.1:5174' },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3002' },
    },
  ],
})

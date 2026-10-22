import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure', headless: true },
  webServer: {
    command: 'npm run dev:app',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 45000,
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:5188',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}
  },
  webServer: {
    command: `npm run ${process.env.PLAYWRIGHT_USE_PREVIEW ? 'preview' : 'dev'} -- --host 127.0.0.1 --port 5188 --strictPort`,
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: !process.env.CI
  }
});

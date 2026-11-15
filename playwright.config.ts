import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts',
  testIgnore: '**/*.generated.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 30_000, expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'reports/latest/html', open: 'never' }], ['json', { outputFile: 'reports/latest/results.json' }]],
  outputDir: 'reports/latest/artifacts',
  use: {
    baseURL: process.env.BASE_URL, testIdAttribute: process.env.TEST_ID_ATTRIBUTE ?? 'data-testid',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'off',
    actionTimeout: 10_000, navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

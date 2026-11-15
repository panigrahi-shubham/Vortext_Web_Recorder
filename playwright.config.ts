import { defineConfig } from '@playwright/test';
import path from 'node:path';

const reportDir = process.env.VORTEX_REPORT_DIR || 'reports/latest';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts',
  testIgnore: '**/*.generated.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 30_000, expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: path.join(reportDir, 'html'), open: 'never' }], ['json', { outputFile: path.join(reportDir, 'results.json') }]],
  outputDir: path.join(reportDir, 'artifacts'),
  use: {
    baseURL: process.env.BASE_URL, testIdAttribute: process.env.TEST_ID_ATTRIBUTE ?? 'data-testid',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'off',
    actionTimeout: 10_000, navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

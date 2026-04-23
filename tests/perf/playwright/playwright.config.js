// NOTE: headless: false is required — Chrome extensions don't load in headless mode. In CI use: Xvfb-run -a npm test

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  testDir: './tests',
  timeout: 90_000,
  retries: 1,
  workers: 1,
  outputDir: 'reports/test-artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright-results.json' }],
  ],
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium-extension',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

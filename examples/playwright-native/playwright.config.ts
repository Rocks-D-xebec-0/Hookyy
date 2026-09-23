import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Playwright's JSON reporter omits hooks; Hookyy's reporter records them (writes hookyy-playwright.json).
  // Equivalent without touching config: npx playwright test --reporter=list,hookyy/playwright-reporter
  reporter: [['list'], ['hookyy/playwright-reporter']],
  use: { headless: true },
});

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Deliberately slow setup -> SLOW
  await page.waitForTimeout(1200);
  await page.setContent('<h1>Shop</h1>');
});

test.afterEach(async ({ page }) => {
  await page.close();
});

test('pays with card', { tag: '@smoke' }, async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Shop');
});

test('legacy flow', async ({ page }) => {
  test.skip(true, 'legacy flow is being rewritten');
  await expect(page.locator('h1')).toHaveText('Shop');
});

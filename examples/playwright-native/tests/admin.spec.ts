import { test, expect } from '@playwright/test';

test.describe('Admin', () => {
  // Every test in this block is skipped, but the hook still runs -> ORPHANED
  test.beforeEach('seed admin data', async ({ page }) => {
    await page.setContent('<ul><li>alice</li><li>bob</li></ul>');
  });

  test('lists users', { tag: '@admin' }, async ({ page }) => {
    test.skip(true, 'admin API not deployed on this env');
    await expect(page.locator('li')).toHaveCount(2);
  });
});

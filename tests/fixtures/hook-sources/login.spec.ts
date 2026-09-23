import { test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill('standard_user');
  await page.fill('#password', 'secret_sauce');
  await page.click('#login-button');
});

// A cheap hook that only creates page objects.
test.beforeEach(async ({ page }) => {
  // await page.goto('/commented-out');
  const title = '{ not a brace }';
  void title;
});

test.beforeEach('Navigating to shop', async ({ inventoryPage }) => {
  await inventoryPage.visit();
});

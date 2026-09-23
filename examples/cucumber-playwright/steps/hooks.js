const { Before, After, BeforeAll, AfterAll, setDefaultTimeout } = require('@cucumber/cucumber');
const { chromium } = require('@playwright/test');

setDefaultTimeout(30000);
let browser;

BeforeAll(async function () {
  browser = await chromium.launch();
});

AfterAll(async function () {
  await browser.close();
});

// Slow (600ms > 500ms threshold) -> SLOW.
// Intended for @db only (see hookTags in hook-auditor.config.yml), but someone
// widened it to "@db or @smoke" -> TAG_MISMATCH on "Guest checkout".
Before({ tags: '@db or @smoke' }, async function () {
  await new Promise((r) => setTimeout(r, 600)); // pretend to reset the database
});

Before(async function () {
  this.context = await browser.newContext();
  this.page = await this.context.newPage();
});

// Only @wip scenarios use this hook, and they are skipped -> ORPHANED.
Before({ tags: '@wip' }, async function () {
  await new Promise((r) => setTimeout(r, 100));
});

After(async function () {
  await this.context?.close();
});

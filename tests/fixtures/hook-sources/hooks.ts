import { After, Before } from '@cucumber/cucumber';

Before(async function () {
  await resetDatabase();
  await new Promise((r) => setTimeout(r, 500));
});

After(async function ({ result }) {
  await this.context.tracing.stop({ path: `trace-${Date.now()}.zip` });
  await this.page.screenshot({ path: 'last.png' });
});

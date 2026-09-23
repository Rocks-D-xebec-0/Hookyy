# Playwright (native)

```bash
npm install
npx playwright install chromium
npm test             # writes hookyy-playwright.json (via hookyy/playwright-reporter)
npm run audit:hooks
```

Expected: `beforeEach hook (tests/checkout.spec.ts:3)` is **SLOW** (1.2s > 1s default) and
`seed admin data (tests/admin.spec.ts:5)` is **ORPHANED** (it only runs for skipped tests).

Don't use `--reporter=json` for Hookyy: Playwright's JSON reporter never includes hook steps.

Tip: name your hooks (`test.beforeEach('seed admin data', ...)`) so Hookyy can tell them
apart at a glance. Unnamed hooks show up as `beforeEach hook (<file>:<line>)`.

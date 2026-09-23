# Cucumber.js + Playwright

```bash
npm install
npx playwright install chromium
npm test            # writes reports/hookyy.ndjson (Cucumber Messages)
npm run audit:hooks # terminal table + reports/hooks.html (from the config)
```

Expected findings:

| Hook | Issue | Why |
| --- | --- | --- |
| `steps/hooks.js:18` (DB reset) | TAG_MISMATCH | declared for `@db` but its source says `@db or @smoke`, so it runs on "Guest checkout" |
| `steps/hooks.js:18` (DB reset) | SLOW | 600ms, threshold is 500ms |
| `steps/hooks.js:28` (@wip) | ORPHANED | only runs for the skipped @wip scenario |

If you edit `hooks.js`, update the line number in `hookTags` (keys are substring-matched
against the hook location, so `"hooks.js:18"` works too).

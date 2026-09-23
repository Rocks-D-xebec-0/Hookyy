# Cypress + Cucumber (badeball preprocessor)

Cypress's built-in `--reporter json` (mocha) carries no hook timings. Use the cucumber
preprocessor's Cucumber Messages output instead (enabled in `.cypress-cucumber-preprocessorrc.json`,
or with `--env messagesEnabled=true` and no file change).

```bash
npm install
npm test             # writes reports/hookyy.ndjson
npm run audit:hooks
```

`hook-auditor.config.yml` declares that the Before hook in `search.js` is meant for `@api`
scenarios, so Hookyy reports **TAG_MISMATCH** for "Search from the home page".

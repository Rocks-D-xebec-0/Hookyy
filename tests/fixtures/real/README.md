# Real-world reports

Reports produced by running the test suites of public GitHub projects during the field test
(see `docs/field-test.md`). They are trimmed (attachments, screenshots, raw feature sources and long error
messages removed) and otherwise unmodified.

| File | Source project | Producer |
|---|---|---|
| `cucumberjs12-tallyb.json` / `.ndjson` | [Tallyb/cucumber-playwright](https://github.com/Tallyb/cucumber-playwright) | cucumber-js 12.2 (JSON + Messages) |
| `cucumberjs9-ortonikc.json` | [ortoniKC/Playwright_Cucumber_TS](https://github.com/ortoniKC/Playwright_Cucumber_TS) | cucumber-js 9 (JSON) |
| `cucumberjs8-rajatt95.ndjson` | [rajatt95/Playwright_JS_BDD](https://github.com/rajatt95/Playwright_JS_BDD) | cucumber-js 8.1 (Messages, untyped hooks) |
| `cucumberjs6-puppeteer.json` | [spirosikmd/cucumber-puppeteer-example](https://github.com/spirosikmd/cucumber-puppeteer-example) | cucumber-js 6 (JSON with hook locations) |
| `cucumberjvm7-skeleton.ndjson` | [cucumber/cucumber-java-skeleton](https://github.com/cucumber/cucumber-java-skeleton) + probe hooks | Cucumber-JVM 7.34 (Messages) |
| `playwright-json-angelo.json` | [angelo-loria/playwright-boilerplate](https://github.com/angelo-loria/playwright-boilerplate) | Playwright 1.46 `--reporter=json` |

Keep these files unmodified when changing parsers: they exist to stop Hookyy from drifting back to
assumptions that only hold for hand-written fixtures.

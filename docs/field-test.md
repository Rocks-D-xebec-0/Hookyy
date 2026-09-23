# Field test: 41 public e2e projects in two rounds

**Date:** 2026-09-23 · **Hookyy:** 0.1.0 (pre-release) · **Machine:** Windows 11, Node 24

Round 1 ran Hookyy against 21 public GitHub test-automation projects, and round 2 against 20 more. Each project was cloned, its suite run,
and Hookyy pointed at the report it produced. No test code was changed, with one disclosed exception
(a probe hooks class in the Cucumber-JVM skeleton, below). Two projects needed a one-line *config*
change to write any report at all, and both are noted. The goal was to find out whether the tool works on real
reports rather than on fixtures written to match its own assumptions.

It didn't, at first. Across both rounds the field test found **15 bugs**, including two design-level ones.
All are fixed with regression tests, and the real reports that exposed them are now test fixtures
(`tests/fixtures/real/`).

## Round 1: projects

| # | Project | Stack | Suite | Hooks found | Findings |
|---|---|---|---|---|---|
| 1 | Tallyb/cucumber-playwright | cucumber-js 12 + Playwright | ✅ pass | 4 (messages) | 2 UNUSED (`@ignore`, `@debug` hooks) |
| 2 | ortoniKC/Playwright_Cucumber_TS | cucumber-js 9 + Playwright | ⚠️ some fail | 3 (messages) | UNUSED `@auth` hook (no `@auth` scenario exists); SLOW After (3.2 s/scenario: trace + video) |
| 3 | VinayKumarBM/playwright-cucumber-sample | cucumber-js 8 + Playwright | ✅ pass | 2 | none |
| 4 | adamcegielka/playwright-cucumber-bdd-typescript | cucumber-js 9 + Playwright | ⚠️ some fail | 2 | none |
| 5 | PrinceSoni83/playwright-cucumber-js-e2e-boilerplate | cucumber-js 7 + Playwright | ⚠️ some fail | 3 | none |
| 6 | rajatt95/Playwright_JS_BDD | cucumber-js 8 + Playwright | ⚠️ some fail | 2 | none |
| 7 | serenity-js/serenity-js-cucumber-playwright-template | cucumber-js 13 + Serenity/JS | ✅ pass | 3 (messages) | SLOW AfterAll (1.04 s) |
| 8 | spirosikmd/cucumber-puppeteer-example | cucumber-js 6 + Puppeteer | ❌ target site gone | 2 | SLOW Before |
| 9 | cucumber/cucumber-js (self-test) | cucumber-js 13 | ❌ aborted (needs Windows Developer Mode) | 0 | none (correctly warns: incomplete run) |
| 10 | cucumber/cucumber-js-examples | cucumber-js (official example) | ✅ pass | 0 | none |
| 11 | cucumber/cucumber-java-skeleton | Cucumber-JVM 7.34 | ✅ pass | 3* | *probe hooks; see below |
| 12 | JoanEsquivel/cypress-cucumber-boilerplate | Cypress 13 + @badeball 15 | ✅ pass | 0 | none |
| 13 | vitalets/playwright-bdd-example | playwright-bdd 9 | ✅ pass | 0 | none |
| 14 | MauricioSabajMorales/playwright-saucedemo-e2e | Playwright 1.58 | ✅ pass | 1 | none |
| 15 | andrewbayd/playwright-page-object | Playwright 1.12 | ❌ site changed | 0 | none |
| 16 | angelo-loria/playwright-boilerplate | Playwright 1.46 | ❌ browser not installed | 4 | every hook **failed** (browser for Playwright 1.46 missing); see correction below |
| 17 | darshaan-chavda/playwright-ts-web-pom | Playwright 1.62 | ❌ setup needs credentials | 0 | none |
| 18 | ecureuill/saucedemo-playwright | Playwright 1.40 | ⚠️ some fail | 6 | 6 SLOW `beforeEach` (cart: **7.6 s per test**) |
| 19 | idavidov13/Playwright-Framework | Playwright 1.52 | ❌ setup needs credentials | 0 | none |
| 20 | jaktestowac/playwright-examples-testwarez-2025 | Playwright 1.56 | ⚠️ some fail | 10 | 10 SLOW `beforeEach` (`page.goto('/')`, ~2.85 s every time) |
| 21 | monikakonieczna/playwright-ts-project | Playwright 1.63 | ✅ pass | 3 | 3 SLOW `beforeEach` (UI login per test) |

Not run: heedrox/cypress-cucumber-example (Cypress 6 with the deprecated preprocessor, testing google.es).
It was replaced by #12, which uses the preprocessor Hookyy documents.

Failing suites are still useful: hooks run whether or not the scenario passes, and a Hookyy run on a
failing suite must not crash or produce nonsense. None did.

**Spot checks.** Findings were checked against the hook source. Every SLOW `beforeEach` above does real
network or UI work (navigating to a remote site, logging in through the UI). angelo's hooks, at ~15 ms,
were correctly not flagged *(corrected later: see below)*. ortoniKC's `@auth` hook is dead code: no feature file uses `@auth`.

## Round 1: bugs found and fixed

| # | Bug | Found in | Fix |
|---|---|---|---|
| 1 | **Playwright's JSON reporter never contains hooks.** It only serializes `test.step` steps (verified in the source of 1.40, 1.46 and 1.62). The original parser was built on a fixture that assumed otherwise, so it would report "0 hooks, no issues" for every Playwright project. | angelo, darshaan | New `hookyy/playwright-reporter` (Reporter API; exact hook locations), used from the command line with no config change. Playwright JSON input now shows a clear warning. |
| 2 | **cucumber-js 7+ JSON has no hook locations.** Hooks were named `Before hook #1 (features/x.feature)`, so one hook became N "hooks", one per feature file. | vinaykumar, ortoniKC (6 → 2 hooks) | Positional names (`Before #1`) plus a warning. New Cucumber Messages parser with exact locations and tag expressions. |
| 3 | UNUSED is impossible from JSON reports: a hook that never runs isn't in the report. | design gap | Messages list every registered hook, so hooks whose tags matched nothing are now reported. |
| 4 | An aborted run (crashed workers) made every registered hook "UNUSED". | cucumber-js self-test | Incomplete runs (missing/failed `testRunFinished`, or fewer cases started than planned) trigger a warning and suppress declaration-based UNUSED. Steps without a result are "unknown", not "skipped". |
| 5 | Untyped BeforeAll/AfterAll (cucumber-js ≤ 9 messages have no `type`) were reported as UNUSED. | 5 projects | An untagged hook that no test case schedules must be a run hook. |
| 6 | SLOW fired on a single cold-start outlier (the first scenario pays for the browser launch). | Tallyb (1.1 s, then ~100 ms) | Compare the average run instead (`rules.slow.metric: max` keeps the strict behaviour). Superseded by the median in round 2 (#13). |
| 7 | Reporter crashed on Playwright < 1.20 (methods called unconditionally; no `titlePath()`). | andrewbayd (1.12) | No-op methods; `titlePath` fallback. |
| 8 | Reporter wrote output and locations relative to the test directory, not the project. | ecureuill | Resolve from the config file's directory, like built-in reporters. |
| 9 | Cucumber-JVM hooks had meaningless ids in Messages (`hook 4bf6…`). JVM references are Java methods, not files. | java-skeleton | Named `com.acme.Hooks.setUp()`, identical to the JVM JSON report. |
| 10 | Terminal table truncated long hook names (Java methods, deep paths). | java-skeleton | Hard-wrap the hook cell only. |

## Round 1: things Hookyy can't fix (documented)

- **Cucumber-JVM with `@ConfigurationParametersResource`.** The suite's properties file overrides `-Dcucumber.plugin`,
  so a report plugin has to be added to `cucumber.properties`. That's a one-line config change, not a test change.
- **ts-node without source maps.** Hook locations point into transpiled JavaScript (ortoniKC reports line 63
  for a hook on line 18). Enable source maps for accurate locations.
- **Cypress's built-in JSON reporter** (mocha) has no hook data. Use the cucumber preprocessor's Messages output.

## The one disclosed code change

cucumber-java-skeleton has no hooks, so for #11 a probe class (`@BeforeAll`, `@Before`, `@Before("@wip")`,
`@After`) was added to the scratch clone to check that Hookyy parses Cucumber-JVM hooks. This tests the
parser, not the zero-change promise. Without the probe, both JVM formats parse correctly with 0 hooks.

## Reproducing

Reports were produced with each project's own runner plus, at most, a reporter flag:

```bash
# cucumber-js (any version with the message formatter, i.e. 7+)
npx cucumber-js --format message:hookyy-messages.ndjson
# Playwright
npx playwright test --reporter=line,hookyy/playwright-reporter
# Cypress + @badeball/cypress-cucumber-preprocessor
npx cypress run --env messagesEnabled=true,messagesOutput=hookyy-messages.ndjson
# Cucumber-JVM (cucumber.properties): cucumber.plugin=..., message:target/hookyy-messages.ndjson
```

---

# Round 2: 20 more projects

Round 2 deliberately went after what round 1 lacked: Cucumber-JVM projects with real hooks, WebdriverIO,
older Cypress, and hook-heavy Playwright suites. It found **5 more bugs**, all fixed with regression tests.
The test suite went from 94 to 105 tests.

| # | Project | Stack | Suite | Hooks | Findings |
|---|---|---|---|---|---|
| 22 | Nikhilkhairnar44/Playwright-AI-Generated-Framework | cucumber-js 10 (parallel 4) + Playwright | ⚠️ some fail | 2 | none |
| 23 | Pragya-19/Playwright-TypeScript-Cucumber-BDD-Framework | cucumber-js 10 + Playwright | ❌ undefined steps | 2 | none (after fix #11) |
| 24 | Vishnupv160/playwright_Javascript_v1.0 | cucumber-js 9 + Playwright | ❌ BeforeAll crashes | 0 | correctly warns: run did not complete |
| 25 | uzimanOye-QA/Playwright-Typescript-UI-TestAutomation | cucumber-js 12 + Playwright | ✅ pass | 0 | none |
| 26 | serenity-js/serenity-js-cucumber-template | cucumber-js 13 + Serenity/JS (REST) | ✅ pass | 3 | SLOW BeforeAll (reporting setup) |
| 27 | serenity-js/serenity-js-cucumber-webdriverio-template | **WebdriverIO 9** + cucumber 13 | ✅ pass | 1 | none (Serenity's internal After hook) |
| 28 | TheBrainFamily/cypress-cucumber-example | **Cypress 4** + old preprocessor | ⚠️ live sites | 0 | none: its hooks are Mocha `beforeEach`, which that preprocessor doesn't report |
| 29 | TestRoverAutomation/Playwright-BDD-Automation | playwright-bdd 7 | ⚠️ some fail | 0 | none |
| 30 | vasu31dev/playwright-ts-template | Playwright | ✅ pass | 1 | SLOW named hook "Navigating to sauce demo page" (2.2–2.6 s) |
| 31 | serenity-js/serenity-js-playwright-test-template | Playwright 1.63 + Serenity/JS | ⚠️ some fail | 1 | SLOW `beforeEach` (1.3–1.8 s) |
| 32 | ernestoalbarez/playwright-ts-framework-skeleton | Playwright 1.58 | ✅ pass | 0 | none |
| 33 | contactmithuroy/playwright-typescript-enterprise-framework | Playwright 1.58 | ✅ pass | 2 | none |
| 34 | YehorYehorychev/Playwright-UI-API-Framework | Playwright 1.58 | ⚠️ some fail | 6 | 6 SLOW `beforeEach`: homepage load **6–15 s per test**, about 13 min per run over 102 tests |
| 35 | akshayp7/playwright-java-cucumber | Cucumber-JVM 7.11 + Playwright-Java | ✅ pass | 3 | SLOW `launchBrowser()` (new browser per scenario, typically 3.2 s) |
| 36 | sbhumir/CucumberSeleniumJava | Cucumber-JVM 6.8 + Selenium 3 | ⚠️ old driver | 4 | SLOW `browserSetup()` |
| 37 | susnigdha1/PlaywrightTestAutomationFramework | Cucumber-JVM 6.10 + Spring (JUnit 5) | ❌ browser download 400 | 0 | none (empty report handled) |
| 38 | ouassimbellout1/CypressTS-13-Cucumber-badeball | Cypress 13 + @badeball 16 | ❌ sites down | n/a | no report: the project doesn't `await addCucumberPreprocessorPlugin`, so report outputs never register |
| 39 | ghoshasish99/Playwright-Java-Cucumber | Cucumber-JVM | ❌ doesn't compile on JDK 17 (old Lombok) | n/a | not analyzed |
| 40 | neiltorrentira/PlaywrightJavaBDDMaven | Cucumber-JVM | ❌ requires Java 25 | n/a | not analyzed |
| 41 | WarleyGabriel/demo-webdriverio-cucumber | WebdriverIO 6 | ❌ 2021 chromedriver vs current Chrome | n/a | not analyzed |

Not run: labs42io/web-automation (needs Docker Selenium; Docker isn't installed) and
TheBrainFamily/cypress-cucumber-typescript-example (Cypress 8, not cached; its preprocessor can't run on Cypress 10+).

**Spot checks:** all SLOW findings are consistent across runs (for example, YehorYehorychev's 12 runs of one hook
range from 6.5 s to 15.7 s), and each hook does real network work (loading a heavy SPA, launching a browser).

## Round 2: bugs found and fixed

| # | Bug | Found in | Fix |
|---|---|---|---|
| 11 | Scenarios with **undefined** steps (missing step definitions) were classified as *skipped*, so their hooks were flagged ORPHANED. | Pragya-19 | Full Cucumber precedence: failed > ambiguous > undefined > pending > skipped > passed. |
| 12 | Unnamed scenarios (valid Gherkin) showed as "undefined" and would merge into one entry. | sbhumir | Named `(unnamed scenario, line N)` from the Gherkin AST / JSON `line`. |
| 13 | SLOW with the *average* was still distorted by cold starts: one 115 s first run (Playwright-Java downloading browsers) pushed a 3 s hook's average to 23 s; a 3.9 s first login flagged a 0.7 s hook. | akshayp7, monika | Default metric is now the **median** (`avg` and `max` stay available). |
| 14 | One report per worker/shard/spec (WebdriverIO writes `hookyy-messages.0-0.ndjson`, …; the old Cypress preprocessor writes one JSON per feature) couldn't be analyzed as one run. | serenity-wdio, TheBrainFamily | `hookyy analyze` takes several files, directories and wildcards (expanded by Hookyy, so they work on Windows too), merged into one run. |
| 15 | A report with **no scenarios** (run died in setup, empty JSON) printed "✔ No hook issues found", and so did a report with scenarios but no hooks. | susnigdha1, TheBrainFamily | Both now say plainly that nothing could be audited. |

## Round 2: things Hookyy can't fix (documented)

- **WebdriverIO:** Cucumber formatters work through `--cucumberOpts.format=message:hookyy.ndjson` (no config change).
  WebdriverIO adds a worker suffix to the file name, so analyze `"hookyy*.ndjson"`.
- **Cypress + @badeball:** `addCucumberPreprocessorPlugin` must be awaited in `setupNodeEvents`, or no report is written.
- **Old Cypress preprocessor (`cypress-cucumber-preprocessor` ≤ 4):** only Cucumber hooks are reported; Mocha
  `beforeEach` blocks never appear in its JSON. Enabling its JSON output needs `cucumberJson.generate` in `package.json`.
- **Framework-internal hooks** (e.g. Serenity/JS's `/internal/serenity-js/cucumber` After hook) show up like user hooks;
  hide them with `ignore`.

---

# Level-up validation (after round 2)

The field test showed that almost every useful finding was a slow hook, and that the hooks were slow for a
handful of recurring reasons. So Hookyy now recognises what a hook does from its source, reports hook time as a
share of the run, catches cumulative cost (SETUP_COST), reports hooks that threw (FAILING), and can run the tests
itself (`hookyy run -- <command>`). All of it was checked against the field projects.

**Insights, checked against the hook source of every field project with a report:**

| Project | Hook | Hookyy says | Correct? |
| --- | --- | --- | --- |
| YehorYehorychev | 6 × `beforeEach` | loads a page before every test | ✅ `homePage.navigate()` |
| akshayp7 (Java) | `Hooks.launchBrowser()` | starts a browser for every scenario | ✅ |
| akshayp7 (Java) | `Hooks.takeScreenshotAndTrace()` | captures traces, videos or screenshots | ✅ |
| sbhumir (Java) | `HooksSteps.browserSetup()` | starts a browser for every scenario | ✅ `new ChromeDriver()` |
| monikakonieczna | 3 × `beforeEach` | logs in through the UI; loads a page | ✅ fills username/password, clicks login |
| jaktestowac | `weather.spec.ts:7` | logs in through the UI; loads a page | ✅ it fills a login form |
| ecureuill | `beforeEach` (cart, checkout…) | loads a page before every test | ✅ `inventoryPage.visit()` (pattern added after the first check missed it) |
| vasu31dev, serenity-js templates | `beforeEach` | loads a page before every test | ✅ |
| Tallyb | Before (`recordVideo`) | captures traces, videos or screenshots | ⚠️ only when `PWVIDEO` is set, so the wording is neutral ("captures", not "on every run") |
| ortoniKC | After (trace + video) | none | ❌ locations point into transpiled JS (ts-node without source maps), so the source can't be read |

**SETUP_COST** in the field: monikakonieczna's `Login.test.spec.ts` hook runs in 922 ms (under SLOW's 1 s) but
adds 7 s, 18% of the run. Neither rule on its own would have explained where the time goes.

**FAILING** found real hook failures in 5 projects (all verified in the raw reports), and one of them is a
correction to round 1:

> **Correction.** Round 1 said angelo-loria's hooks were "~15 ms and correctly not flagged". They weren't fast:
> every hook failed with `browserType.launch: Executable doesn't exist … chromium-1129`, because the browser for
> that project's Playwright version was never installed in the test environment. With FAILING, Hookyy now reports
> this directly.

**`hookyy run`, end to end:** `hookyy run -- npx playwright test` (monikakonieczna), `hookyy run -- npm test`
(Nikhilkhairnar44, cucumber-js behind an npm script) and `hookyy run -- <mvn> -q test` (akshayp7, Cucumber-JVM)
each detected the runner, added the reporter flag, ran the suite, analyzed the result, and passed the tests'
exit code through. `hookyy init` picked the right runner for Tallyb (cucumber-js, not Playwright), the Serenity/JS
WebdriverIO template (wdio, not cucumber-js), ecureuill and the Java skeleton, after fixing two detection mistakes
the first attempt made on those projects.

**Node 14:** the built CLI, the Playwright reporter and the API were run on Node 14.21 (the minimum in
`engines`), not just Node 24.

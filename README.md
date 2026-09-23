# 🪝 Hookyy

**Find out how much of your test run is spent in hooks, and what to change.** Hookyy reads the report your
tests already produce, measures every `Before`/`beforeEach`/`After` hook, recognises what each slow hook
does (launching a browser, logging in through the UI, loading a page…) and tells you the fix.
You don't change any test code.

```bash
npx hookyy run -- npx playwright test        # or: npm test, npx cucumber-js, npx cypress run, mvn test…
```

```
Hooks took 10m 27s of 15m 50s test time (66%)
┌────────────────────────────────────────────────────┬───────┬──────────┬──────────────────────────────────┐
│ Costliest hooks                                    │ Runs  │ Total    │ What it does                     │
├────────────────────────────────────────────────────┼───────┼──────────┼──────────────────────────────────┤
│ beforeEach hook (tests/ui/mobalytics-home.spec.ts: │ 29    │ 3m 49s   │ loads a page before every test   │
│ 20)                                                │       │          │                                  │
│ …                                                  │       │          │                                  │
```

<sub>Real output from [YehorYehorychev/Playwright-UI-API-Framework](https://github.com/YehorYehorychev/Playwright-UI-API-Framework),
one of the 41 public projects Hookyy was field-tested on ([docs/field-test.md](docs/field-test.md)).</sub>

## What it finds

| Code | Finds | Default |
| --- | --- | --- |
| `FAILING` | Hooks that **threw**, with the error. A broken After hook often hides the real failure. | error |
| `SLOW` | Hooks whose **typical (median) run** is over a threshold (default 1 s) | warning |
| `SETUP_COST` | Per-scenario hooks that are fast enough per run but **expensive in total** (default ≥ 30 s, or ≥ 10% of the run) | warning |
| `UNUSED` | Hooks that **never ran**: registered but matched no scenario, or skipped every time | warning |
| `ORPHANED` | Hooks that ran only for **skipped** scenarios | warning |
| `TAG_MISMATCH` | Hooks that ran outside the tag scope you **declared** for them (opt-in via `hookTags`) | error |

For every costly hook, Hookyy reads its source and recognises what it does, so the recommendation is specific:

| It sees… | It suggests |
| --- | --- |
| a browser launched per scenario | launch once (BeforeAll / worker fixture), new context per scenario |
| a UI login | log in once and reuse the session (`storageState`, a saved cookie, an API login) |
| a page load before every test | navigate only where needed, or set up state via API first |
| traces, videos or screenshots | capture them only on failure |
| database resets or seeding | seed once per worker, or use transactions |
| a fixed wait | wait for the condition instead |

This works for JavaScript/TypeScript hooks (file and line) and Cucumber-JVM hooks (Java class and method).

## Quick start

```bash
npm install --save-dev hookyy
npx hookyy init            # detects your framework and prints the command
npx hookyy init --write    # adds a "test:hooks" script and a starter hook-auditor.config.yml
npm run test:hooks
```

`hookyy run -- <your test command>` adds the right reporter flag for the framework, runs the tests, then
analyzes their hooks. It works with the runner directly or behind an `npm`/`yarn`/`pnpm` script:

| Runner | What `hookyy run` adds |
| --- | --- |
| Playwright Test / playwright-bdd | `--reporter=list,hookyy/playwright-reporter` |
| cucumber-js 7+ (with Playwright, Puppeteer, Selenium, Serenity/JS…) | `--format message:.hookyy/messages.ndjson` |
| Cypress + `@badeball/cypress-cucumber-preprocessor` | `--env messagesEnabled=true,messagesOutput=…` |
| WebdriverIO + Cucumber | `--cucumberOpts.format=message:…` (one file per worker, merged) |
| Cucumber-JVM (Maven) | `-Dcucumber.plugin=message:…` |

It exits with your tests' exit code when they fail, otherwise with Hookyy's (see `--fail-on`), so CI behaves
as before. Requires Node.js 14 or later.

## Usage

```bash
hookyy run [options] -- <test command>     # run the tests and analyze them
hookyy analyze <reports..> [options]       # analyze reports you already have
hookyy init [--write]                      # detect the framework, suggest (or add) the command
```

`<reports..>` is one or more files, directories (every `.json`/`.ndjson` inside) or file-name wildcards
(`"reports/*.ndjson"`, expanded by Hookyy so they work on Windows too). Several reports, such as one per
worker, shard or spec, are merged into one run.

| Option | Description |
| --- | --- |
| `-f, --format` | `cli` (default), `html`, `json`, `markdown` |
| `-o, --output` | Write the report to a file instead of stdout |
| `--fail-on` | Exit with code 1 if any issue is at or above this severity: `error`, `warning`, `info` |
| `-c, --config` | Path to `hook-auditor.config.yml` (auto-discovered in the current directory) |
| `-v, --verbose` | Recommendations, evidence and per-hook timing table |
| `-w, --watch` | (`analyze`) Re-analyze whenever the report changes |
| `--parser` | (`analyze`) Force a parser: `cucumber-messages`, `cucumber`, `hookyy`, `playwright` (auto-detected per file) |
| `--out-dir` | (`run`) Where the reporter writes (default `.hookyy`) |
| `--no-color` | Disable ANSI colors |

**Exit codes:** `0` OK · `1` `--fail-on` threshold reached · `2` usage or runtime error. `hookyy run` returns the
test command's code when the tests failed.

### Adding the reporter yourself

If you'd rather produce the report in your own pipeline, add one reporter flag and use `hookyy analyze`:

```bash
npx playwright test --reporter=list,hookyy/playwright-reporter && npx hookyy analyze hookyy-playwright.json
npx cucumber-js --format message:reports/hookyy.ndjson       && npx hookyy analyze reports/hookyy.ndjson
npx cypress run --env messagesEnabled=true,messagesOutput=reports/hookyy.ndjson
npx wdio run wdio.conf.ts --cucumberOpts.format=message:reports/hookyy.ndjson && npx hookyy analyze "reports/hookyy*.ndjson"
mvn test -Dcucumber.plugin=message:target/hookyy.ndjson      && npx hookyy analyze target/hookyy.ndjson
```

> **Why not `playwright test --reporter=json`?** Playwright's JSON reporter never includes hook steps, in any
> version. Hookyy detects such files and tells you to use its reporter instead.
>
> **Cucumber-JVM with `@ConfigurationParametersResource` / `@ConfigurationParameter`:** the suite's settings override
> `-D` flags, so add `message:target/hookyy.ndjson` to `cucumber.plugin` there.
>
> **Legacy Cucumber JSON** (`--format json:…`) is supported too, but cucumber-js 7+ omits hook locations from it,
> so hooks are named by position (`Before #1`) and can't be traced back to source.

### CI (GitHub Actions)

```yaml
- run: npx hookyy run --fail-on error -f markdown -o hooks.md -- npx playwright test
- run: cat hooks.md >> "$GITHUB_STEP_SUMMARY"
  if: always()
```

## Configuration

Create a `hook-auditor.config.yml` (or `hookyy.config.yml`) in your project root, or run `hookyy init --write`:

```yaml
rules:
  failing:     { enabled: true, severity: error }
  slow:        { enabled: true, severity: warning, threshold: 1000, metric: median }  # metric: median | avg | max
  cost:        { enabled: true, severity: warning, minTotal: 30000, minShare: 0.1, minRuns: 3 }
  unused:      { enabled: true, severity: warning }
  orphaned:    { enabled: true, severity: warning }
  tagMismatch: { enabled: true, severity: error }

# Used when --format is not given
reporters:
  - type: cli
  - type: html
    output: reports/hooks.html

# Hooks to leave out (substring match on name or location), e.g. framework internals
ignore:
  - /internal/serenity-js/

# The tag scope each hook is *meant* to have; Hookyy reports runs outside it
hookTags:
  "support/db.hooks.ts:10": "@db and not @readonly"

# Hooks that must run somewhere; any that never appear are reported as UNUSED
expectedHooks:
  - features/support/hooks.ts:42

# Where hook source files are resolved from (default: the config file's directory)
rootDir: .
```

Hook names in `expectedHooks`, `hookTags` and `ignore` are matched as substrings against the hook name or
location. CLI flags override the config.

## How it works

- **Hook time and share.** Every hook run is measured; the share is hook time over total test time (shown only
  when the report's durations support it).
- **SLOW** compares each hook's *median* run to the threshold, so cold starts (the first test paying for a browser
  launch or download) don't distort it. In the field, one 115 s first run pushed a 3 s hook's average to 23 s.
- **SETUP_COST** catches what SLOW can't: a 700 ms login in 300 tests is 3.5 minutes per run. It skips hooks SLOW
  already reports, and ignores small suites (a share only counts from 5 s of hook time).
- **Insights** come from each hook's source, with comments stripped. They describe what a hook *does*; whether that
  happens on every run (for example, screenshots only on failure) can't always be seen statically.
- **Cucumber Messages** (`.ndjson`) list every registered hook with its location and tag expression, so hooks
  that matched no scenario are reported as UNUSED. Only the final attempt of retried scenarios counts. If the run
  didn't complete (crashed workers, fail-fast, a failing BeforeAll), Hookyy warns and doesn't report
  registered-but-unrun hooks.
- **Cucumber precedence:** a scenario with undefined or ambiguous steps is *broken*, not skipped, so it never makes
  its hooks ORPHANED.
- **Playwright** hooks are the steps reported with category `hook`, named `<title> (<file>:<line>)`. Name your
  hooks (`test.beforeEach('seed data', …)`) for readable reports.
- **TAG_MISMATCH** is about intent: Cucumber applies tag expressions correctly, so the report rarely contradicts
  the code. Declare each hook's intended scope in `hookTags` to be told when it drifts.

**TypeScript tip:** if you run cucumber-js through ts-node without source maps, reported hook lines point into
transpiled JavaScript, and insights can't be read. Enable source maps.

## Programmatic API

```ts
import { analyze, report, shouldFail } from 'hookyy';

const { result } = analyze({
  reportPaths: ['reports/*.ndjson'],
  config: { rules: { slow: { threshold: 500 } } },
});

console.log(result.summary.totalHookTime, result.summary.totalTestTime);
report(result, [{ type: 'html', output: 'hooks.html' }]);
if (shouldFail(result, ['error'])) process.exit(1);
```

### Extending

Parsers, rules and reporters are plain classes:

```ts
import { BaseParser, BaseRule, registerParser, analyze } from 'hookyy';

class JUnitParser extends BaseParser {
  name = 'junit';
  detect(data) { return typeof data === 'object' && data !== null && 'testsuites' in data; }
  parse(data) { return { framework: 'junit', scenarios: [/* ScenarioData[] */] }; }
}
registerParser(new JUnitParser());   // now auto-detected, and available via --parser junit

class NoAfterAllRule extends BaseRule {
  code = 'UNUSED' as const;
  configKey = 'unused' as const;
  description = 'Forbid afterAll hooks';
  check(ctx) {
    return [...ctx.hooks.values()]
      .filter((h) => h.type === 'afterAll')
      .map((h) => this.issue(ctx, h.name, 'afterAll hook found', 'Use a worker fixture instead'));
  }
}
analyze({ reportPath: 'report.ndjson', rules: [new NoAfterAllRule()] });
```

## Field-tested

Hookyy was run on 41 public e2e projects: cucumber-js 6–13, Cucumber-JVM 6–7, WebdriverIO, Cypress 4–13 and
Playwright 1.12–1.63. That found 15 bugs, all fixed with regression tests against the real reports
(`tests/fixtures/real/`). See [docs/field-test.md](docs/field-test.md).

## Examples

- [`examples/cucumber-playwright`](examples/cucumber-playwright): Cucumber.js driving Playwright
- [`examples/playwright-native`](examples/playwright-native): Playwright Test with `hookyy/playwright-reporter`
- [`examples/cypress-cucumber`](examples/cypress-cucumber): Cypress with the cucumber preprocessor

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup: dist/index.js (CJS), dist/index.mjs (ESM), dist/cli.js, dist/playwright-reporter.js
node dist/cli.js analyze tests/fixtures/real/cucumberjs12-tallyb.ndjson -v
```

## License

MIT

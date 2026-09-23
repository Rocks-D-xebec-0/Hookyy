# Changelog

## 0.1.1

- Package metadata: author (Mosbah Houcem Eddine), copyright holder in LICENSE.
- README: Status, License and Author sections.

## 0.1.0

First release. Field-tested on 41 public e2e projects before release (see `docs/field-test.md`).

### Commands
- `hookyy run -- <test command>`: detects the runner (directly or behind an npm/yarn/pnpm script), adds the
  right reporter flag, runs the tests and analyzes their hooks. Passes the tests' exit code through.
- `hookyy analyze <reports..>`: one or more files, directories or wildcards, merged into one run
  (one report per worker/shard/spec).
- `hookyy init [--write]`: detects the framework and prints (or adds) a `test:hooks` script and a starter config.

### Inputs
- Cucumber Messages (`.ndjson`) from cucumber-js 7+, Cucumber-JVM, Cypress (@badeball) and WebdriverIO:
  exact hook locations, tag expressions and hooks that never ran.
- `hookyy/playwright-reporter` for Playwright Test and playwright-bdd (Playwright's JSON reporter has no hooks).
- Legacy Cucumber JSON (cucumber-js, Ruby, JVM).

### Findings
- `FAILING`: hooks that threw, with the error message.
- `SLOW`: median run over a threshold (median resists cold starts; `avg` and `max` available).
- `SETUP_COST`: per-scenario hooks that are cheap per run but expensive in total.
- `UNUSED`, `ORPHANED`, `TAG_MISMATCH`.
- Hook time as a share of total test time, and the costliest hooks.
- Insights from hook source (JS/TS and Java): browser launch, UI login, navigation, artifact capture, data setup,
  fixed waits, each with a specific fix.

### Output
- Terminal table, JSON, Markdown (PR comments, CI summaries) and a self-contained interactive HTML dashboard.
- Honest reporting: warnings when a report can't answer the question (Playwright JSON, aborted runs, empty reports).

Supports Node.js 14+ (verified on 14.21).

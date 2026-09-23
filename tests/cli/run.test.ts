import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProject, writeInit } from '../../src/cli/init';
import { cleanOutDir, planRun } from '../../src/cli/run';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookyy-run-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const pkg = (content: object) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(content, null, 2) + '\n');
const plan = (cmd: string) => planRun(cmd.split(' '), dir, '.hookyy', '/abs/playwright-reporter.js');

describe('planRun: direct runner commands', () => {
  it('Playwright: adds the Hookyy reporter (keeping a console reporter) and sets the output file', () => {
    const p = plan('npx playwright test --project=chromium');
    expect(p.framework).toBe('playwright');
    expect(p.command).toBe('npx playwright test --project=chromium --reporter=list,/abs/playwright-reporter.js');
    expect(p.env.HOOKYY_OUTPUT_FILE).toBe(path.resolve(dir, '.hookyy', 'playwright.json'));
    expect(p.reports).toEqual(['.hookyy/playwright.json']);
  });

  it('Playwright: extends an existing --reporter instead of adding a second one', () => {
    expect(plan('npx playwright test --reporter=dot').command).toBe('npx playwright test --reporter=dot,/abs/playwright-reporter.js');
  });

  it('cucumber-js: adds a Cucumber Messages formatter', () => {
    const p = plan('npx cucumber-js --tags @smoke');
    expect(p.command).toBe('npx cucumber-js --tags @smoke --format message:.hookyy/messages.ndjson');
    expect(p.reports).toEqual(['.hookyy/messages.ndjson']);
  });

  it('Cypress: enables the preprocessor Messages output, merging into an existing --env', () => {
    expect(plan('npx cypress run').command).toBe('npx cypress run --env messagesEnabled=true,messagesOutput=.hookyy/messages.ndjson');
    expect(plan('npx cypress run --env stage=qa').command).toBe('npx cypress run --env stage=qa,messagesEnabled=true,messagesOutput=.hookyy/messages.ndjson');
  });

  it('WebdriverIO: one Messages file per worker, analyzed by wildcard', () => {
    const p = plan('npx wdio run wdio.conf.ts');
    expect(p.command).toBe('npx wdio run wdio.conf.ts --cucumberOpts.format=message:.hookyy/messages.ndjson');
    expect(p.reports).toEqual(['.hookyy/messages*.ndjson']);
  });

  it('Maven: adds the message plugin as a system property, with a note about suite annotations', () => {
    const p = plan('mvn test -Dtest=Runner');
    expect(p.command).toBe('mvn test -Dtest=Runner -Dcucumber.plugin=message:.hookyy/messages.ndjson');
    expect(p.notes.join(' ')).toMatch(/ConfigurationParametersResource/);
    expect(plan('./mvnw test').framework).toBe('maven');
  });

  it('rejects commands it cannot map to a runner', () => {
    expect(() => plan('npx jest')).toThrow(/Can't tell which test runner/);
    expect(() => planRun([], dir)).toThrow(/No test command/);
  });
});

describe('planRun: package manager scripts', () => {
  it('npm test: resolves the script and passes the flag after --', () => {
    pkg({ scripts: { test: 'cucumber-js --config config/cucumber.js' } });
    const p = plan('npm test');
    expect(p.framework).toBe('cucumber-js');
    expect(p.command).toBe('npm test -- --format message:.hookyy/messages.ndjson');
  });

  it('yarn/pnpm scripts: pass the flag directly', () => {
    pkg({ scripts: { e2e: 'playwright test' } });
    expect(plan('yarn e2e').command).toBe('yarn e2e --reporter=list,/abs/playwright-reporter.js');
    expect(plan('npm run e2e').command).toBe('npm run e2e -- --reporter=list,/abs/playwright-reporter.js');
  });

  it('warns when the runner is not the last command of a chained script', () => {
    pkg({ scripts: { test: 'cucumber-js && node report.js' } });
    expect(plan('npm test').notes.join(' ')).toMatch(/chains several commands/);
    pkg({ scripts: { test: 'npx bddgen && npx playwright test' } });
    expect(plan('npm test').notes.join(' ')).not.toMatch(/chains several commands/);
  });

  it('errors on a missing script', () => {
    pkg({ scripts: {} });
    expect(() => plan('npm run nope')).toThrow(/No "nope" script/);
  });
});

describe('cleanOutDir', () => {
  it('removes only Hookyy report files', () => {
    const out = path.join(dir, '.hookyy');
    fs.mkdirSync(out);
    for (const f of ['messages.ndjson', 'messages.0-1.ndjson', 'playwright.json', 'keep.txt']) fs.writeFileSync(path.join(out, f), 'x');
    cleanOutDir(dir, '.hookyy');
    expect(fs.readdirSync(out)).toEqual(['keep.txt']);
  });
});

describe('init', () => {
  it('detects frameworks and prefers the existing script that runs them', () => {
    pkg({ scripts: { test: 'npx bddgen && npx playwright test', lint: 'eslint' }, devDependencies: { '@playwright/test': '1', 'playwright-bdd': '8' } });
    expect(detectProject(dir)).toEqual([{ framework: 'playwright-bdd', command: 'npm test', why: '"test" script: npx bddgen && npx playwright test' }]);
  });

  it('scripts beat dependencies (field test: Tallyb, serenity-js WebdriverIO template)', () => {
    // cucumber-js project that uses @playwright/test only as a browser library, no playwright.config
    pkg({ scripts: { cucumber: 'tsx node_modules/@cucumber/cucumber/bin/cucumber.js' }, devDependencies: { '@playwright/test': '1', '@cucumber/cucumber': '12' } });
    expect(detectProject(dir).map((d) => d.framework)).toEqual(['cucumber-js']);
    // WebdriverIO runner with @cucumber/cucumber installed for step definitions
    pkg({ scripts: { test: 'wdio wdio.conf.ts' }, devDependencies: { '@cucumber/cucumber': '13', '@wdio/cli': '9' } });
    expect(detectProject(dir)).toEqual([{ framework: 'WebdriverIO + Cucumber', command: 'npm test', why: '"test" script: wdio wdio.conf.ts' }]);
  });

  it('counts Playwright Test only when a playwright.config exists', () => {
    pkg({ devDependencies: { '@playwright/test': '1' } });
    expect(detectProject(dir)).toEqual([]);
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
    expect(detectProject(dir).map((d) => d.command)).toEqual(['npx playwright test']);
  });

  it('falls back to the plain runner command and detects Maven projects', () => {
    pkg({ devDependencies: { '@cucumber/cucumber': '12' } });
    fs.writeFileSync(path.join(dir, 'pom.xml'), '<artifactId>cucumber-java</artifactId>');
    expect(detectProject(dir).map((d) => d.command)).toEqual(['npx cucumber-js', 'mvn test']);
  });

  it('writes a test:hooks script, a starter config and a .gitignore entry, without overwriting', () => {
    pkg({ scripts: { test: 'cucumber-js' }, devDependencies: { '@cucumber/cucumber': '12' } });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules');
    const [d] = detectProject(dir);
    expect(writeInit(dir, d)).toEqual(['package.json (script "test:hooks")', 'hook-auditor.config.yml', '.gitignore (.hookyy/)']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts['test:hooks']).toBe('hookyy run -- npm test');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.hookyy/\n');
    expect(writeInit(dir, d)).toEqual([]); // idempotent
  });
});

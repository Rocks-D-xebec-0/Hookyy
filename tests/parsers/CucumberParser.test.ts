import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { CucumberParser } from '../../src/parsers';
import { CUCUMBER_ROOT, fixture } from '../helpers';

const load = (name: string) => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));

describe('CucumberParser', () => {
  const parser = new CucumberParser();

  it('detects cucumber reports and rejects others', () => {
    expect(parser.detect(load('cucumber-report.json'))).toBe(true);
    expect(parser.detect([])).toBe(true);
    expect(parser.detect(load('real/playwright-json-angelo.json'))).toBe(false);
    expect(parser.detect({ elements: [] })).toBe(false);
  });

  it('extracts scenarios with feature + scenario tags', () => {
    const parsed = parser.parse(load('cucumber-report.json'), { rootDir: CUCUMBER_ROOT });
    expect(parsed.framework).toBe('cucumber');
    expect(parsed.scenarios.map((s) => s.name)).toEqual([
      'Checkout › Pay with card',
      'Checkout › Pay with voucher',
      'Checkout › Guest checkout',
    ]);
    expect(parsed.scenarios[0].tags).toEqual(['@checkout', '@db']);
  });

  it('classifies passed / skipped / failed scenarios', () => {
    const [card, voucher, guest] = parser.parse(load('cucumber-report.json'), { rootDir: CUCUMBER_ROOT }).scenarios;
    expect(card).toMatchObject({ passed: true, skipped: false });
    expect(voucher).toMatchObject({ passed: false, skipped: true });
    expect(guest).toMatchObject({ passed: false, skipped: false });
  });

  it('treats a scenario skipped mid-way (passed, skipped, skipped) as skipped', () => {
    const hook = { keyword: 'Before', hidden: true, match: { location: 'h.js:1' }, result: { status: 'passed', duration: 5e6 } };
    const step = (status: string) => ({ keyword: 'Given ', name: 's', result: { status, duration: 0 } });
    const report = [{ name: 'F', elements: [{ name: 'S', type: 'scenario', steps: [hook, step('passed'), step('skipped'), step('skipped')] }] }];
    const [s] = parser.parse(report).scenarios;
    expect(s).toMatchObject({ skipped: true, passed: false });
    expect(s.hooks[0].scenarioSkipped).toBe(true);
  });

  it('counts a hook that returned "skipped" (non-zero duration) as executed', () => {
    const report = [{ name: 'F', elements: [{ name: 'S', type: 'scenario', steps: [
      { keyword: 'Before', hidden: true, match: { location: 'h.js:1' }, result: { status: 'skipped', duration: 3e6 } },
      { keyword: 'Given ', name: 's', result: { status: 'skipped', duration: 0 } },
    ] }] }];
    expect(parser.parse(report).scenarios[0].hooks[0]).toMatchObject({ skipped: false, duration: 3 });
  });

  it('extracts hidden Before/After hook steps with durations in ms', () => {
    const [card] = parser.parse(load('cucumber-report.json'), { rootDir: CUCUMBER_ROOT }).scenarios;
    expect(card.hooks.map((h) => [h.hookName, h.type, h.duration])).toEqual([
      ['features/support/hooks.js:5', 'before', 1500],
      ['features/support/hooks.js:12', 'before', 200],
      ['features/support/hooks.js:20', 'after', 50],
    ]);
  });

  it('reads hook tag expressions from source (object and string forms)', () => {
    const scenarios = parser.parse(load('cucumber-report.json'), { rootDir: CUCUMBER_ROOT }).scenarios;
    const byName = new Map(scenarios.flatMap((s) => s.hooks).map((h) => [h.hookName, h.hookTags]));
    expect(byName.get('features/support/hooks.js:5')).toBe('@db');
    expect(byName.get('features/support/hooks.js:12')).toBeUndefined();
    expect(byName.get('features/support/hooks.js:40')).toBe('@payments');
  });

  it('marks hooks that did not run as skipped', () => {
    const guest = parser.parse(load('cucumber-report.json'), { rootDir: CUCUMBER_ROOT }).scenarios[2];
    expect(guest.hooks.find((h) => h.hookName.endsWith(':40'))?.skipped).toBe(true);
  });

  it('supports the Ruby/JVM before/after layout and skips backgrounds', () => {
    const parsed = parser.parse(load('cucumber-ruby-report.json'), { rootDir: CUCUMBER_ROOT });
    expect(parsed.scenarios).toHaveLength(2);
    const [valid, locked] = parsed.scenarios;
    expect(valid.hooks.map((h) => h.type)).toEqual(['before', 'after']);
    expect(locked.skipped).toBe(true);
    expect(locked.hooks[0].scenarioSkipped).toBe(true);
  });

  it('works without source files (no tags, no crash)', () => {
    const parsed = parser.parse(load('cucumber-report.json'), { rootDir: '/does/not/exist' });
    expect(parsed.scenarios.flatMap((s) => s.hooks).every((h) => h.hookTags === undefined)).toBe(true);
  });

  it('throws a helpful error for non-array input', () => {
    expect(() => parser.parse({})).toThrow(/array of features/);
  });
});

describe('CucumberParser on real reports', () => {
  const parser = new CucumberParser();

  it('cucumber-js 12 (no hook locations): positional names + warning', () => {
    // Tallyb/cucumber-playwright
    const parsed = parser.parse(load('real/cucumberjs12-tallyb.json'));
    const names = new Set(parsed.scenarios.flatMap((s) => s.hooks.map((h) => h.hookName)));
    expect(names).toEqual(new Set(['Before #1', 'After #1']));
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings![0]).toContain('--format message:');
  });

  it('does not split one hook into one entry per feature (regression)', () => {
    // ortoniKC/Playwright_Cucumber_TS: 1 Before + 1 After across 3 feature files.
    const { result } = analyze({ reportPath: fixture('real/cucumberjs9-ortonikc.json'), config: {} });
    expect(Array.from(result.hooks.keys()).sort()).toEqual(['After #1', 'Before #1']);
    expect(result.summary.totalScenarios).toBe(6);
  });

  it('cucumber-js 6 (with hook locations): exact names, no warning', () => {
    // spirosikmd/cucumber-puppeteer-example
    const parsed = parser.parse(load('real/cucumberjs6-puppeteer.json'));
    const names = new Set(parsed.scenarios.flatMap((s) => s.hooks.map((h) => h.hookName)));
    expect(names).toEqual(new Set(['features/support/steps.js:3', 'features/support/steps.js:7']));
    expect(parsed.warnings).toEqual([]);
  });
});

describe('scenario status precedence (regression: Pragya-19 field test)', () => {
  const parser = new CucumberParser();
  const hook = { keyword: 'Before', hidden: true, match: { location: 'h.js:1' }, result: { status: 'passed', duration: 5e6 } };
  const step = (status: string) => ({ keyword: 'Given ', name: 's', result: { status, duration: 0 } });
  const parse = (...statuses: string[]) =>
    parser.parse([{ name: 'F', elements: [{ name: 'S', type: 'scenario', steps: [hook, ...statuses.map(step)] }] }]).scenarios[0];

  it('undefined outranks skipped: a scenario with missing step definitions is broken, not skipped', () => {
    expect(parse('passed', 'undefined', 'skipped')).toMatchObject({ skipped: false, passed: false });
  });
  it('ambiguous outranks skipped', () => {
    expect(parse('ambiguous', 'skipped')).toMatchObject({ skipped: false, passed: false });
  });
  it('pending counts as skipped', () => {
    expect(parse('passed', 'pending', 'skipped')).toMatchObject({ skipped: true, passed: false });
  });
});

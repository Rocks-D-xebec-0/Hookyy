import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import HookyyPlaywrightReporter from '../../src/playwright/reporter';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookyy-pw-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Minimal stand-ins for Playwright's TestCase / TestResult / TestStep objects. */
function testCase(id: string, file: string, titles: string[], tags: string[] = []) {
  return { id, title: titles[titles.length - 1], tags, titlePath: () => ['', 'chromium', file, ...titles] };
}
function group(title: string) {
  return { title, category: 'hook', duration: 0 };
}
function hook(title: string, parent: ReturnType<typeof group>, file: string, line: number, duration: number, error?: unknown) {
  return { title, category: 'hook', duration, parent, location: { file: path.join(dir, file), line }, error };
}

describe('hookyy/playwright-reporter', () => {
  it('records hook steps (not fixtures or group steps) and writes a report hookyy can analyze', () => {
    const reporter = new HookyyPlaywrightReporter({ outputFile: 'out/hooks.json' });
    reporter.onBegin({ rootDir: path.join(dir, 'tests'), configFile: path.join(dir, 'playwright.config.ts'), version: '1.62.1', projects: [{ name: 'chromium' }] });

    const t1 = testCase('t1', path.join('tests', 'cart.spec.ts'), ['Cart', 'adds item'], ['@smoke']);
    const r1 = { status: 'passed', duration: 900, startTime: new Date(0) };
    const before = group('Before Hooks');
    reporter.onStepEnd(t1, r1, { title: 'fixture: page', category: 'fixture', duration: 50, parent: before, location: { file: path.join(dir, 'x.ts'), line: 1 } });
    reporter.onStepEnd(t1, r1, hook('beforeEach hook', before, 'tests/cart.spec.ts', 5, 1500));
    reporter.onStepEnd(t1, r1, before);
    const after = group('After Hooks');
    reporter.onStepEnd(t1, r1, hook('cleanup cart', after, 'tests/cart.spec.ts', 12, 10));
    reporter.onTestEnd(t1, r1);

    const t2 = testCase('t2', path.join('tests', 'cart.spec.ts'), ['Cart', 'legacy']);
    const r2 = { status: 'skipped', duration: 1200 };
    reporter.onStepEnd(t2, r2, hook('beforeEach hook', group('Before Hooks'), 'tests/cart.spec.ts', 5, 1100));
    reporter.onTestEnd(t2, r2);
    reporter.onEnd();

    const file = path.join(dir, 'out/hooks.json');
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(report).toMatchObject({ hookyyReport: 1, framework: 'playwright', generator: 'hookyy/playwright-reporter (playwright 1.62.1)' });
    expect(report.scenarios.map((s: any) => [s.name, s.skipped, s.tags])).toEqual([
      ['tests/cart.spec.ts › Cart › adds item', false, ['@smoke']],
      ['tests/cart.spec.ts › Cart › legacy', true, []],
    ]);
    expect(report.scenarios[0].hooks.map((h: any) => [h.hookName, h.type, h.duration])).toEqual([
      ['beforeEach hook (tests/cart.spec.ts:5)', 'before', 1500],
      ['cleanup cart (tests/cart.spec.ts:12)', 'after', 10],
    ]);
    expect(report.scenarios[1].hooks[0].scenarioSkipped).toBe(true);

    const { result, parser } = analyze({ reportPath: file, config: {} });
    expect(parser).toBe('hookyy');
    expect(result.issues.map((i) => `${i.code}:${i.hookName}`)).toEqual(['SLOW:beforeEach hook (tests/cart.spec.ts:5)']);
  });

  it('marks failed hooks and detects beforeAll/afterAll by title', () => {
    const reporter = new HookyyPlaywrightReporter({ outputFile: 'r.json' });
    reporter.onBegin({ rootDir: dir, configFile: path.join(dir, 'playwright.config.ts') });
    const t = testCase('t', 'a.spec.ts', ['x']);
    const r = { status: 'failed', duration: 1 };
    reporter.onStepEnd(t, r, hook('beforeAll hook', group('Before Hooks'), 'a.spec.ts', 2, 5, { message: 'boom' }));
    reporter.onStepEnd(t, r, hook('afterAll hook', group('After Hooks'), 'a.spec.ts', 9, 5));
    reporter.onTestEnd(t, r);
    reporter.onEnd();
    const hooks = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8')).scenarios[0].hooks;
    expect(hooks.map((h: any) => [h.type, h.passed])).toEqual([
      ['beforeAll', false],
      ['afterAll', true],
    ]);
  });

  it('is a CommonJS-compatible default export (Playwright loads it via require)', () => {
    expect(typeof HookyyPlaywrightReporter).toBe('function');
    const r = new HookyyPlaywrightReporter();
    expect(r.printsToStdio()).toBe(false);
    // Playwright < 1.20 calls these unconditionally.
    for (const m of ['onTestBegin', 'onStepBegin', 'onStdOut', 'onStdErr', 'onError'] as const) expect(typeof r[m]).toBe('function');
  });
});

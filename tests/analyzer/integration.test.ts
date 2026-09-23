import { describe, expect, it } from 'vitest';
import { analyze, shouldFail } from '../../src';
import { CUCUMBER_ROOT, fixture } from '../helpers';

describe('end-to-end analysis of fixtures', () => {
  it('finds all four issue types in the cucumber fixture', () => {
    const { result, parser } = analyze({
      reportPath: fixture('cucumber-report.json'),
      config: { rootDir: CUCUMBER_ROOT },
    });
    expect(parser).toBe('cucumber');
    expect(result.issues.map((i) => `${i.severity}:${i.code}:${i.hookName}`)).toEqual([
      'error:TAG_MISMATCH:features/support/hooks.js:5',
      'warning:SLOW:features/support/hooks.js:5',
      'warning:ORPHANED:features/support/hooks.js:30',
      'warning:UNUSED:features/support/hooks.js:40',
    ]);
    expect(result.summary).toMatchObject({ totalHooks: 5, totalScenarios: 3, errorCount: 1, warningCount: 3 });
  });

  it('finds orphaned and slow hooks in the playwright fixture', () => {
    const { result, parser } = analyze({ reportPath: fixture('playwright-hookyy.json'), config: {} });
    expect(parser).toBe('hookyy');
    expect(result.issues.map((i) => `${i.code}:${i.hookName}`)).toEqual([
      'SLOW:beforeEach hook (tests/checkout.spec.ts:4)',
      'ORPHANED:seed admin data (tests/admin.spec.ts:5)',
    ]);
  });

  it('shouldFail compares against the lowest requested severity', () => {
    const { result } = analyze({ reportPath: fixture('playwright-hookyy.json'), config: {} });
    expect(shouldFail(result, [])).toBe(false);
    expect(shouldFail(result, ['error'])).toBe(false);
    expect(shouldFail(result, ['warning'])).toBe(true);
    expect(shouldFail(result, ['error', 'warning'])).toBe(true);
  });

  it('runs well under a second for a large report', () => {
    const features = Array.from({ length: 200 }, (_, f) => ({
      uri: `features/f${f}.feature`,
      name: `Feature ${f}`,
      elements: Array.from({ length: 50 }, (_, s) => ({
        name: `Scenario ${s}`,
        type: 'scenario',
        tags: [{ name: s % 2 ? '@a' : '@b' }],
        steps: [
          { keyword: 'Before', hidden: true, match: { location: `hooks.js:${s % 10}` }, result: { status: 'passed', duration: 1e6 } },
          { keyword: 'Given ', name: 'x', result: { status: 'passed', duration: 1e6 } },
        ],
      })),
    }));
    const started = Date.now();
    const { result } = analyze({ data: features, config: {} });
    expect(result.summary.totalScenarios).toBe(10000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('empty reports (regression: susnigdha1 / Vishnupv160 field test)', () => {
  it('warns instead of claiming a clean result when the report has no scenarios', async () => {
    const { CLIReporter } = await import('../../src/reporters');
    const { result } = analyze({ data: [], parser: 'cucumber', config: {} });
    expect(result.warnings[0]).toMatch(/no scenarios/);
    const out = new CLIReporter().render(result, { color: false });
    expect(out).toContain('No hooks could be audited');
    expect(out).not.toContain('No hook issues found');
  });
});

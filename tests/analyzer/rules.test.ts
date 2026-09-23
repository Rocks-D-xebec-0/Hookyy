import { describe, expect, it } from 'vitest';
import { HookAnalyzer } from '../../src/analyzer/HookAnalyzer';
import { BaseRule, RuleContext } from '../../src/analyzer/rules';
import { mergeConfig } from '../../src/config/ConfigLoader';
import { defaultConfig } from '../../src/config/DefaultConfig';
import type { HookIssue, PartialConfig } from '../../src/types';
import { data, scenario } from '../helpers';

const run = (scenarios: ReturnType<typeof scenario>[], cfg: PartialConfig = {}) =>
  new HookAnalyzer(mergeConfig(defaultConfig(), cfg)).analyze(data(scenarios));
const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => `${i.code}:${i.hookName}`);

describe('OrphanedHookRule', () => {
  it('flags hooks that only ran for skipped scenarios', () => {
    const r = run([
      scenario('skipped 1', [{ hookName: 'wip' }], { skipped: true }),
      scenario('skipped 2', [{ hookName: 'wip' }], { skipped: true }),
      scenario('passing', [{ hookName: 'login' }]),
    ]);
    expect(codes(r)).toEqual(['ORPHANED:wip']);
    expect(r.issues[0].evidence).toEqual([{ scenario: 'skipped 1' }, { scenario: 'skipped 2' }]);
  });

  it('does not flag a hook that ran for at least one executed scenario', () => {
    const r = run([scenario('skipped', [{ hookName: 'h' }], { skipped: true }), scenario('ok', [{ hookName: 'h' }])]);
    expect(r.issues).toEqual([]);
  });
});

describe('UnusedHookRule', () => {
  it('flags hooks that were skipped every time', () => {
    const r = run([scenario('a', [{ hookName: 'never', skipped: true }]), scenario('b', [{ hookName: 'never', skipped: true }])]);
    expect(codes(r)).toEqual(['UNUSED:never']);
  });

  it('flags expected hooks that are missing from the report', () => {
    const r = run([scenario('a', [{ hookName: 'hooks.ts:1', location: 'hooks.ts:1' }])], {
      expectedHooks: ['hooks.ts:1', 'hooks.ts:99'],
    });
    expect(codes(r)).toEqual(['UNUSED:hooks.ts:99']);
  });
});

describe('SlowHookRule', () => {
  it('flags hooks whose typical (median) run exceeds the threshold (default metric)', () => {
    const r = run(
      [scenario('a', [{ hookName: 'db', duration: 1500 }]), scenario('b', [{ hookName: 'db', duration: 1300 }]), scenario('c', [{ hookName: 'fast', duration: 5 }])],
      { rules: { slow: { threshold: 1000 } } },
    );
    expect(codes(r)).toEqual(['SLOW:db']);
    expect(r.issues[0].message).toMatch(/Typical \(median\) run exceeds 1s: median 1\.4s, avg 1\.4s, max 1\.5s; 2\/2 run\(s\) over budget/);
    expect(r.issues[0].evidence).toEqual([{ scenario: 'a', duration: 1500 }, { scenario: 'b', duration: 1300 }]);
  });

  it('ignores cold-start outliers by default; avg and max are opt-in', () => {
    // Field data (monikakonieczna): a UI-login beforeEach, 3.9s cold then ~0.7s.
    const hooks = [3953, 1576, 853, 699, 641, 698].map((d, i) => scenario(`s${i}`, [{ hookName: 'login', duration: d }]));
    expect(codes(run(hooks))).toEqual([]); // median 775ms
    expect(codes(run(hooks, { rules: { slow: { metric: 'avg' } } }))).toEqual(['SLOW:login']); // avg 1.4s
    expect(codes(run(hooks, { rules: { slow: { metric: 'max' } } }))).toEqual(['SLOW:login']);
    // Tallyb: one 1.1s browser-launch run among fast ones.
    const tallyb = [1100, 120, 80].map((d, i) => scenario(`t${i}`, [{ hookName: 'setup', duration: d }]));
    expect(codes(run(tallyb))).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const r = run([scenario('a', [{ hookName: 'db', duration: 150 }])], { rules: { slow: { threshold: 100 } } });
    expect(codes(r)).toEqual(['SLOW:db']);
  });
});

describe('TagMismatchRule', () => {
  it('flags hooks that ran on scenarios not matching their tag expression', () => {
    const r = run([
      scenario('db scenario', [{ hookName: 'db', hookTags: '@db' }], { tags: ['@db'] }),
      scenario('smoke scenario', [{ hookName: 'db', hookTags: '@db' }], { tags: ['@smoke'] }),
    ]);
    expect(codes(r)).toEqual(['TAG_MISMATCH:db']);
    expect(r.issues[0].severity).toBe('error');
    expect(r.issues[0].evidence).toEqual([{ scenario: 'smoke scenario', tags: ['@smoke'] }]);
  });

  it('supports complex expressions and config-declared tags', () => {
    const r = run(
      [scenario('a', [{ hookName: 'api' }], { tags: ['@api', '@slow'] }), scenario('b', [{ hookName: 'api' }], { tags: ['@api'] })],
      { hookTags: { api: '@api and not @slow' } },
    );
    expect(r.issues.map((i) => i.evidence)).toEqual([[{ scenario: 'a', tags: ['@api', '@slow'] }]]);
  });

  it('ignores hooks without a tag expression or with an invalid one', () => {
    const r = run([scenario('a', [{ hookName: 'x', hookTags: '@a and (' }]), scenario('b', [{ hookName: 'y' }])]);
    expect(r.issues).toEqual([]);
  });
});

describe('HookAnalyzer', () => {
  const sample = () => [
    scenario('a', [{ hookName: 'slow', duration: 5000 }]),
    scenario('b', [{ hookName: 'wip' }], { skipped: true }),
  ];

  it('builds per-hook stats and summary', () => {
    const r = run([scenario('a', [{ hookName: 'h', duration: 10 }]), scenario('b', [{ hookName: 'h', duration: 30 }])]);
    const h = r.hooks.get('h')!;
    expect(h.avgDuration).toBe(20);
    expect(h.maxDuration).toBe(30);
    expect(h.totalDuration).toBe(40);
    expect(Array.from(h.scenariosAffected)).toEqual(['a', 'b']);
    expect(r.summary).toMatchObject({ totalHooks: 1, totalScenarios: 2, totalExecutions: 2, issuesFound: 0 });
  });

  it('disables rules and overrides severity from config', () => {
    const r = run(sample(), { rules: { orphaned: { enabled: false }, slow: { severity: 'error' } } });
    expect(codes(r)).toEqual(['SLOW:slow']);
    expect(r.summary.errorCount).toBe(1);
  });

  it('ignores hooks matching `ignore` patterns', () => {
    const r = run(sample(), { ignore: ['slow', 'wip'] });
    expect(r.hooks.size).toBe(0);
  });

  it('sorts issues by severity and attaches them to hooks', () => {
    const r = run(
      [...sample(), scenario('c', [{ hookName: 'tagged', hookTags: '@x' }], { tags: ['@y'] })],
    );
    expect(r.issues.map((i) => i.severity)).toEqual(['error', 'warning', 'warning']);
    expect(r.hooks.get('tagged')!.issues).toHaveLength(1);
  });

  it('accepts custom rules', () => {
    class NoAfterHooks extends BaseRule {
      readonly code = 'UNUSED' as const;
      readonly configKey = 'unused' as const;
      readonly description = 'custom';
      check(ctx: RuleContext): HookIssue[] {
        return Array.from(ctx.hooks.values())
          .filter((h) => h.type === 'after')
          .map((h) => this.issue(ctx, h.name, 'after hook', 'remove it'));
      }
    }
    const analyzer = new HookAnalyzer(defaultConfig(), [new NoAfterHooks()]);
    const r = analyzer.analyze(data([scenario('a', [{ hookName: 'teardown', type: 'after' }])]));
    expect(r.issues.map((i) => i.message)).toEqual(['after hook']);
  });
});

describe('FailingHookRule', () => {
  it('reports hooks that threw, grouping evidence by error', () => {
    const r = run([
      scenario('a', [{ hookName: 'teardown', type: 'after', passed: false, error: 'TypeError: page is undefined' }]),
      scenario('b', [{ hookName: 'teardown', type: 'after', passed: false, error: 'TypeError: page is undefined' }]),
      scenario('c', [{ hookName: 'teardown', type: 'after' }]),
    ]);
    expect(codes(r)).toEqual(['FAILING:teardown']);
    expect(r.issues[0].severity).toBe('error');
    expect(r.issues[0].message).toBe('Hook failed in 2/3 run(s).');
    expect(r.issues[0].evidence).toEqual([{ scenario: 'a', error: 'TypeError: page is undefined' }]);
    expect(r.issues[0].recommendation).toMatch(/after-hook can mask the real test failure/);
  });

  it('ignores hooks that were skipped (never ran)', () => {
    expect(run([scenario('a', [{ hookName: 'h', passed: false, skipped: true }])]).issues.map((i) => i.code)).toEqual(['UNUSED']);
  });

  it('carries real error messages from Cucumber Messages (Nikhilkhairnar44 field run)', async () => {
    const { analyze } = await import('../../src');
    const { fixture } = await import('../helpers');
    const { result } = analyze({ reportPath: fixture('real/cucumberjs10-nikhil-failing.ndjson'), config: {} });
    const failing = result.issues.filter((i) => i.code === 'FAILING');
    expect(failing.map((i) => i.hookName).sort()).toEqual(['hooks/hooks.ts:23', 'hooks/hooks.ts:8']);
    const errors = failing.flatMap((i) => i.evidence.map((e: any) => e.error));
    expect(errors.some((e) => /browserType\.launch: Executable doesn't exist/.test(e))).toBe(true);
    expect(errors.some((e) => /Cannot read properties of undefined \(reading 'screenshot'\)/.test(e))).toBe(true);
  });
});

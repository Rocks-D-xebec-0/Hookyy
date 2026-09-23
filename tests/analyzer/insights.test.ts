import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { HookAnalyzer } from '../../src/analyzer/HookAnalyzer';
import { hookInsights, recommendationFor } from '../../src/analyzer/insights';
import { readHookBody } from '../../src/analyzer/source';
import { mergeConfig } from '../../src/config/ConfigLoader';
import { defaultConfig } from '../../src/config/DefaultConfig';
import type { PartialConfig } from '../../src/types';
import { data, fixture, scenario } from '../helpers';

const ROOT = fixture('hook-sources');
const kinds = (location: string) => hookInsights({ location, name: location }, ROOT).map((i) => i.kind);

describe('readHookBody', () => {
  it('returns the balanced block starting at a file:line location', () => {
    const body = readHookBody('login.spec.ts:3', ROOT)!;
    expect(body.split('\n')[0]).toContain('test.beforeEach');
    expect(body.trim().endsWith('});')).toBe(true);
    expect(body).not.toContain('commented-out'); // stops at the end of the first hook
  });

  it('ignores braces inside strings when matching blocks', () => {
    expect(readHookBody('login.spec.ts:11', ROOT)).toContain("void title;");
  });

  it('finds a Java hook method by class and method name (Cucumber-JVM locations)', () => {
    const body = readHookBody('hooks.Hooks.launchBrowser()', ROOT)!;
    expect(body).toContain('public void launchBrowser()');
    expect(body).toContain('initDriver');
    expect(body).not.toContain('quitBrowser');
  });

  it('returns undefined for unknown files, positional names and missing methods', () => {
    expect(readHookBody('nope.ts:1', ROOT)).toBeUndefined();
    expect(readHookBody('Before #1', ROOT)).toBeUndefined();
    expect(readHookBody('hooks.Hooks.doesNotExist()', ROOT)).toBeUndefined();
  });
});

describe('hookInsights (patterns from the field test)', () => {
  it('recognises UI login and navigation (monikakonieczna, jaktestowac)', () => {
    expect(kinds('login.spec.ts:3')).toEqual(['ui-login', 'navigation']);
  });

  it('recognises page-object navigation (ecureuill: inventoryPage.visit())', () => {
    expect(kinds('login.spec.ts:17')).toEqual(['navigation']);
  });

  it('ignores commented-out code and variable names', () => {
    expect(kinds('login.spec.ts:11')).toEqual([]);
  });

  it('recognises data setup and fixed waits', () => {
    expect(kinds('hooks.ts:3')).toEqual(['data-setup', 'fixed-wait']);
  });

  it('recognises artifact capture (ortoniKC, akshayp7)', () => {
    expect(kinds('hooks.ts:8')).toEqual(['tracing']);
  });

  it('recognises a browser launched per scenario in Java (akshayp7: Hooks.launchBrowser)', () => {
    expect(kinds('hooks.Hooks.launchBrowser()')).toEqual(['browser-launch']);
    expect(kinds('hooks.Hooks.quitBrowser()')).toEqual([]);
  });

  it('builds a recommendation from insights, with a fallback', () => {
    const insights = hookInsights({ location: 'login.spec.ts:3', name: 'x' }, ROOT);
    expect(recommendationFor({ type: 'before', insights }, 'fallback')).toMatch(/^This hook logs in through the UI in every test, loads a page before every test\. Log in once/);
    expect(recommendationFor({ type: 'before', insights: [] }, 'fallback')).toBe('fallback');
  });
});

describe('SetupCostRule', () => {
  const run = (durations: number[], cfg: PartialConfig = {}, scenarioDuration = 3000) =>
    new HookAnalyzer(mergeConfig(defaultConfig(), { rootDir: ROOT, ...cfg })).analyze(
      data(durations.map((d, i) => scenario(`s${i}`, [{ hookName: 'login', location: 'login.spec.ts:3', duration: d }], { duration: scenarioDuration }))),
    );

  it('flags a hook that is fast per run but expensive in total (700 ms x 60 runs = 42 s)', () => {
    const r = run(Array(60).fill(700));
    expect(r.issues.map((i) => i.code)).toEqual(['SETUP_COST']);
    expect(r.issues[0].message).toMatch(/^Adds 42s per run across 60 scenarios \(23% of total test time\), at a typical 700ms each\./);
    expect(r.issues[0].recommendation).toMatch(/Log in once and reuse the session/);
  });

  it('flags a large share of the run even below minTotal (needs 5 s of hook time)', () => {
    const r = run(Array(10).fill(600), {}, 1000); // 6 s of hooks in a 10 s run
    expect(r.issues.map((i) => i.code)).toEqual(['SETUP_COST']);
    expect(run(Array(10).fill(300), {}, 500).issues).toEqual([]); // 3 s total: too small to matter
  });

  it('does not double-report hooks SLOW already flags', () => {
    const r = run(Array(40).fill(1500));
    expect(r.issues.map((i) => i.code)).toEqual(['SLOW']);
    expect(r.issues[0].recommendation).toMatch(/^This hook logs in through the UI/);
  });

  it('ignores run-level hooks and hooks with too few runs', () => {
    expect(run([20000, 20000]).issues.filter((i) => i.code === 'SETUP_COST')).toEqual([]);
  });

  it('reports total hook time and test time in the summary', () => {
    const r = run(Array(60).fill(700));
    expect(r.summary.totalHookTime).toBe(42000);
    expect(r.summary.totalTestTime).toBe(180000);
  });
});

describe('insights on analyzed hooks', () => {
  it('are attached to every hook when the source is available', () => {
    const r = new HookAnalyzer(mergeConfig(defaultConfig(), { rootDir: ROOT })).analyze(
      data([scenario('a', [{ hookName: 'java', location: 'hooks.Hooks.launchBrowser()', duration: 10 }])]),
    );
    expect(r.hooks.get('java')!.insights.map((i) => i.kind)).toEqual(['browser-launch']);
    expect(path.isAbsolute(ROOT)).toBe(true);
  });
});

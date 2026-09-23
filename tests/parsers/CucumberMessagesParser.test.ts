import { describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { CucumberMessagesParser, detectParser } from '../../src/parsers';
import { readJsonFile } from '../../src/utils';
import { fixture } from '../helpers';

// Real report: Tallyb/cucumber-playwright, cucumber-js 12.2, `--format message:…`.
const tallyb = () => readJsonFile(fixture('real/cucumberjs12-tallyb.ndjson')) as unknown[];

describe('CucumberMessagesParser (real cucumber-js 12 output)', () => {
  const parser = new CucumberMessagesParser();

  it('reads NDJSON and is auto-detected', () => {
    const data = tallyb();
    expect(Array.isArray(data)).toBe(true);
    expect(detectParser(data).name).toBe('cucumber-messages');
  });

  it('identifies hooks by exact source location, with tag expressions', () => {
    const parsed = parser.parse(tallyb());
    expect(parsed.framework).toBe('cucumber (cucumber-js 12.2.0)');
    expect(parsed.scenarios).toHaveLength(3);
    const executed = new Set(parsed.scenarios.flatMap((s) => s.hooks.map((h) => `${h.hookName}:${h.type}`)));
    expect(executed).toEqual(new Set(['src/support/common-hooks.ts:55:before', 'src/support/common-hooks.ts:79:after']));
    const declared = parsed.declaredHooks!.map((h) => [h.hookName, h.hookTags]);
    expect(declared).toContainEqual(['src/support/common-hooks.ts:47', '@ignore']);
    expect(declared).toContainEqual(['src/support/common-hooks.ts:51', '@debug']);
  });

  it('does not declare BeforeAll/AfterAll when the run has no run-hook messages', () => {
    const parsed = parser.parse(tallyb());
    expect(parsed.declaredHooks!.some((h) => h.type === 'beforeAll' || h.type === 'afterAll')).toBe(false);
  });

  it('flags registered hooks whose tags matched no scenario as UNUSED', () => {
    const { result } = analyze({ reportPath: fixture('real/cucumberjs12-tallyb.ndjson'), config: {} });
    const unused = result.issues.filter((i) => i.code === 'UNUSED').map((i) => i.hookName);
    expect(unused).toEqual(['src/support/common-hooks.ts:47', 'src/support/common-hooks.ts:51']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps only the final attempt of retried test cases and records run hooks', () => {
    const envelopes = [
      { meta: { protocolVersion: '28.0.0', implementation: { name: 'cucumber-js', version: '12.0.0' } } },
      { gherkinDocument: { uri: 'f.feature', feature: { name: 'F' } } },
      { pickle: { id: 'p1', uri: 'f.feature', name: 'Flaky', tags: [{ name: '@flaky' }], steps: [{ id: 'ps1', text: 'x' }] } },
      { hook: { id: 'h1', type: 'BEFORE_TEST_CASE', tagExpression: '@flaky', sourceReference: { uri: 'hooks.ts', location: { line: 3 } } } },
      { hook: { id: 'h2', type: 'BEFORE_TEST_RUN', sourceReference: { uri: 'hooks.ts', location: { line: 1 } } } },
      { testCase: { id: 'tc1', pickleId: 'p1', testSteps: [{ id: 's1', hookId: 'h1' }, { id: 's2', pickleStepId: 'ps1' }] } },
      { testRunHookStarted: { id: 'rh1', hookId: 'h2', timestamp: { seconds: 1, nanos: 0 } } },
      { testRunHookFinished: { testRunHookStartedId: 'rh1', result: { status: 'PASSED', duration: { seconds: 2, nanos: 500000000 } } } },
      { testCaseStarted: { id: 'a0', testCaseId: 'tc1', attempt: 0 } },
      { testStepFinished: { testCaseStartedId: 'a0', testStepId: 's1', testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 9e6 } } } },
      { testStepFinished: { testCaseStartedId: 'a0', testStepId: 's2', testStepResult: { status: 'FAILED', duration: { seconds: 0, nanos: 1e6 } } } },
      { testCaseFinished: { testCaseStartedId: 'a0', willBeRetried: true } },
      { testCaseStarted: { id: 'a1', testCaseId: 'tc1', attempt: 1 } },
      { testStepFinished: { testCaseStartedId: 'a1', testStepId: 's1', testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 7e6 } } } },
      { testStepFinished: { testCaseStartedId: 'a1', testStepId: 's2', testStepResult: { status: 'PASSED', duration: { seconds: 0, nanos: 1e6 } } } },
      { testCaseFinished: { testCaseStartedId: 'a1', willBeRetried: false } },
      { testRunFinished: { success: true } },
    ];
    const parsed = new CucumberMessagesParser().parse(envelopes);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]).toMatchObject({ name: 'F › Flaky', passed: true, tags: ['@flaky'] });
    expect(parsed.scenarios[0].hooks).toEqual([
      expect.objectContaining({ hookName: 'hooks.ts:3', type: 'before', duration: 7, hookTags: '@flaky' }),
    ]);
    expect(parsed.globalHooks).toEqual([expect.objectContaining({ hookName: 'hooks.ts:1', type: 'beforeAll', duration: 2500 })]);
    // Run hooks were observable, so BeforeAll is declared too.
    expect(parsed.declaredHooks!.map((h) => h.hookName).sort()).toEqual(['hooks.ts:1', 'hooks.ts:3']);
  });

  it('does not report UNUSED for an aborted run (seen in the field: crashed workers)', () => {
    // cucumber/cucumber-js self-test on Windows without Developer Mode: 3 of N test cases started, workers died.
    const envelopes = [
      { pickle: { id: 'p1', uri: 'a.feature', name: 'A', tags: [], steps: [{ id: 'ps1' }] } },
      { pickle: { id: 'p2', uri: 'a.feature', name: 'B', tags: [], steps: [{ id: 'ps2' }] } },
      { hook: { id: 'h1', type: 'BEFORE_TEST_CASE', sourceReference: { uri: 'hooks.ts', location: { line: 27 } } } },
      { testCase: { id: 'tc1', pickleId: 'p1', testSteps: [{ id: 's1', hookId: 'h1' }, { id: 's2', pickleStepId: 'ps1' }] } },
      { testCase: { id: 'tc2', pickleId: 'p2', testSteps: [{ id: 's3', hookId: 'h1' }, { id: 's4', pickleStepId: 'ps2' }] } },
      { testCaseStarted: { id: 'a', testCaseId: 'tc1', attempt: 0 } },
      { testRunFinished: { success: false, exception: { type: 'Error', message: 'Worker 1 exited unexpectedly with code 1' } } },
    ];
    const parsed = new CucumberMessagesParser().parse(envelopes);
    expect(parsed.declaredHooks).toEqual([]);
    expect(parsed.scenarios[0].hooks).toEqual([]); // started, but no step results: unknown, not skipped
    expect(parsed.warnings![0]).toMatch(/did not complete \(1\/2 test cases started: Worker 1 exited unexpectedly/);
  });

  it('does not mistake untyped BeforeAll/AfterAll (cucumber-js <= 9) for UNUSED hooks (regression)', () => {
    // rajatt95/Playwright_JS_BDD, cucumber-js 8: hook messages have no `type`; setup/hooks.js:19/26 are BeforeAll/AfterAll.
    const { result } = analyze({ reportPath: fixture('real/cucumberjs8-rajatt95.ndjson'), config: {} });
    expect(result.issues.filter((i) => i.code === 'UNUSED')).toEqual([]);
    expect(Array.from(result.hooks.keys()).sort()).toEqual(['setup/hooks.js:32', 'setup/hooks.js:39']);
    expect(result.hooks.get('setup/hooks.js:32')!.type).toBe('before');
    expect(result.hooks.get('setup/hooks.js:39')!.type).toBe('after');
  });

  it('names cucumber-jvm hooks by Java method, like the JVM JSON report does', () => {
    // cucumber/cucumber-java-skeleton (cucumber-jvm 7.34) + a probe hooks class added for the field test.
    const { result } = analyze({ reportPath: fixture('real/cucumberjvm7-skeleton.ndjson'), config: {} });
    expect(result.framework).toMatch(/^cucumber \(cucumber-jvm 7\./);
    expect(Array.from(result.hooks.keys()).sort()).toEqual([
      'com.example.project.HookyyProbeHooks.onlyForWip()',
      'com.example.project.HookyyProbeHooks.slowSetup()',
      'com.example.project.HookyyProbeHooks.teardown()',
    ]);
    const issues = result.issues.map((i) => `${i.code}:${i.hookName.replace('com.example.project.HookyyProbeHooks.', '')}`);
    expect(issues).toContain('UNUSED:onlyForWip()'); // @Before("@wip"), no @wip scenario
    expect(issues).toContain('SLOW:slowSetup()'); // sleeps 1.2s
  });

  it('infers before/after from position when hooks have no type (older protocol)', () => {
    const envelopes = [
      { pickle: { id: 'p1', uri: 'f.feature', name: 'S', tags: [], steps: [{ id: 'ps1' }] } },
      { hook: { id: 'h1', sourceReference: { uri: 'a.ts', location: { line: 1 } } } },
      { hook: { id: 'h2', sourceReference: { uri: 'a.ts', location: { line: 9 } } } },
      { testCase: { id: 'tc', pickleId: 'p1', testSteps: [{ id: 's0', hookId: 'h1' }, { id: 's1', pickleStepId: 'ps1' }, { id: 's2', hookId: 'h2' }] } },
      { testCaseStarted: { id: 'a', testCaseId: 'tc', attempt: 0 } },
      { testStepFinished: { testCaseStartedId: 'a', testStepId: 's0', testStepResult: { status: 'PASSED' } } },
      { testStepFinished: { testCaseStartedId: 'a', testStepId: 's2', testStepResult: { status: 'PASSED' } } },
    ];
    const hooks = new CucumberMessagesParser().parse(envelopes).scenarios[0].hooks;
    expect(hooks.map((h) => [h.hookName, h.type])).toEqual([
      ['a.ts:1', 'before'],
      ['a.ts:9', 'after'],
    ]);
  });
});

describe('unnamed scenarios (regression: sbhumir/CucumberSeleniumJava)', () => {
  it('names them by line so two unnamed scenarios stay distinct', () => {
    const envelopes = [
      { gherkinDocument: { uri: 'f.feature', feature: { name: 'Login', children: [
        { scenario: { id: 'sc1', name: '', location: { line: 4 } } },
        { rule: { children: [{ scenario: { id: 'sc2', name: '', location: { line: 10 }, examples: [{ tableBody: [{ id: 'row1', location: { line: 14 } }] }] } }] } },
      ] } } },
      { pickle: { id: 'p1', uri: 'f.feature', name: '', astNodeIds: ['sc1'], tags: [], steps: [] } },
      { pickle: { id: 'p2', uri: 'f.feature', name: '', astNodeIds: ['sc2', 'row1'], tags: [], steps: [] } },
      { testCase: { id: 't1', pickleId: 'p1', testSteps: [] } },
      { testCase: { id: 't2', pickleId: 'p2', testSteps: [] } },
      { testCaseStarted: { id: 'a1', testCaseId: 't1' } },
      { testCaseStarted: { id: 'a2', testCaseId: 't2' } },
      { testRunFinished: { success: true } },
    ];
    const names = new CucumberMessagesParser().parse(envelopes).scenarios.map((s) => s.name);
    expect(names).toEqual(['Login › (unnamed scenario, line 4)', 'Login › (unnamed scenario, line 10)']);
  });
});

import type { DeclaredHook, HookExecution, HookType, ParsedTestData, ScenarioData } from '../types';
import { firstLine, HookyyError, unique } from '../utils';
import { BaseParser } from './BaseParser';

type Envelope = Record<string, any>;

interface Duration {
  seconds?: number;
  nanos?: number;
}

const HOOK_TYPES: Record<string, HookType> = {
  BEFORE_TEST_CASE: 'before',
  AFTER_TEST_CASE: 'after',
  BEFORE_TEST_RUN: 'beforeAll',
  AFTER_TEST_RUN: 'afterAll',
};

const NOT_RUN = new Set(['SKIPPED', 'PENDING', 'UNDEFINED', 'UNKNOWN']);
const ENVELOPE_KEYS = new Set(['meta', 'source', 'gherkinDocument', 'pickle', 'hook', 'testCase', 'testRunStarted', 'stepDefinition']);

/**
 * Human-readable hook location from a message SourceReference:
 *  - file + line (cucumber-js, most implementations): "features/support/hooks.ts:12"
 *  - Java method (cucumber-jvm annotations): "com.acme.Hooks.setUp()", matching the JSON report's match.location
 *  - Java stack trace element (cucumber-jvm lambdas): "com.acme.Hooks.<init>(Hooks.java:12)"
 */
function sourceLocation(ref: any): string | undefined {
  if (!ref) return undefined;
  if (ref.uri) {
    const uri = slash(ref.uri);
    return ref.location?.line ? `${uri}:${ref.location.line}` : uri;
  }
  if (ref.javaMethod) {
    const m = ref.javaMethod;
    return `${m.className}.${m.methodName}(${(m.methodParameterTypes ?? []).join(',')})`;
  }
  if (ref.javaStackTraceElement) {
    const e = ref.javaStackTraceElement;
    const line = ref.location?.line ? `:${ref.location.line}` : '';
    return `${e.className}.${e.methodName}(${e.fileName ?? ''}${line})`;
  }
  return undefined;
}

/** Walk feature/rule children, recording the line of each scenario and example row by AST id. */
function collectAstLines(children: any[], out: Map<string, number>): void {
  for (const child of children) {
    if (child.rule) collectAstLines(child.rule.children ?? [], out);
    const sc = child.scenario;
    if (!sc) continue;
    if (sc.id && sc.location?.line) out.set(sc.id, sc.location.line);
    for (const ex of sc.examples ?? []) for (const row of ex.tableBody ?? []) if (row.id && row.location?.line) out.set(row.id, row.location.line);
  }
}

const toMs = (d?: Duration) => (d ? (d.seconds ?? 0) * 1000 + (d.nanos ?? 0) / 1e6 : 0);
const toEpochMs = (d?: Duration) => (d ? toMs(d) : undefined);
const slash = (p: string) => p.replace(/\\/g, '/');

/**
 * Parses Cucumber Messages (NDJSON), the modern output of cucumber-js
 * (`--format message:file.ndjson`), cucumber-jvm (`message:` plugin) and
 * other Cucumber implementations.
 *
 * Unlike the legacy JSON report, messages carry every hook's source location,
 * tag expression and type, including hooks that never ran.
 */
export class CucumberMessagesParser extends BaseParser {
  readonly name = 'cucumber-messages';
  readonly aliases = ['messages', 'ndjson'];

  detect(data: unknown): boolean {
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      data.slice(0, 20).some((e) => e && typeof e === 'object' && Object.keys(e).some((k) => ENVELOPE_KEYS.has(k)))
    );
  }

  parse(data: unknown): ParsedTestData {
    if (!this.detect(data)) {
      throw new HookyyError('Not a Cucumber Messages stream.', 'Generate one with `--format message:report.ndjson`.');
    }
    const envelopes = data as Envelope[];
    const of = (key: string) => envelopes.filter((e) => e[key]).map((e) => e[key]);

    const featureNames = new Map<string, string>();
    const astLines = new Map<string, number>(); // scenario / example-row AST id -> line
    for (const doc of of('gherkinDocument')) {
      if (doc.uri) featureNames.set(doc.uri, doc.feature?.name ?? '');
      collectAstLines(doc.feature?.children ?? [], astLines);
    }

    const pickles = new Map<string, any>(of('pickle').map((p) => [p.id, p]));
    const testCases = new Map<string, any>(of('testCase').map((t) => [t.id, t]));

    // Hook ids referenced by at least one test case (i.e. per-scenario hooks that were scheduled).
    const scheduled = new Set<string>();
    for (const t of testCases.values()) for (const s of t.testSteps ?? []) if (s.hookId) scheduled.add(s.hookId);

    const hooks = new Map<string, DeclaredHook & { rawType?: string }>();
    for (const h of of('hook')) {
      const location = sourceLocation(h.sourceReference);
      let type: HookType = HOOK_TYPES[h.type] ?? 'before';
      // Older protocols (cucumber-js <= 9) omit `type`. An untagged per-scenario hook is scheduled for
      // every test case, so an untagged hook no test case references must be BeforeAll/AfterAll.
      if (!h.type && !h.tagExpression && !scheduled.has(h.id)) type = 'beforeAll';
      hooks.set(h.id, {
        hookName: h.name ? `${h.name} (${location ?? h.id})` : location ?? `hook ${h.id}`,
        type,
        location,
        hookTags: h.tagExpression || undefined,
        rawType: h.type,
      });
    }

    // Results per test-case attempt: testCaseStartedId -> testStepId -> result
    const stepResults = new Map<string, Map<string, any>>();
    for (const f of of('testStepFinished')) {
      if (!stepResults.has(f.testCaseStartedId)) stepResults.set(f.testCaseStartedId, new Map());
      stepResults.get(f.testCaseStartedId)!.set(f.testStepId, f.testStepResult);
    }
    const retried = new Set(of('testCaseFinished').filter((f) => f.willBeRetried).map((f) => f.testCaseStartedId));

    // Keep only the final attempt of each test case (earlier attempts were retried).
    const finalAttempt = new Map<string, any>();
    for (const started of of('testCaseStarted')) {
      if (retried.has(started.id)) continue;
      const prev = finalAttempt.get(started.testCaseId);
      if (!prev || (started.attempt ?? 0) >= (prev.attempt ?? 0)) finalAttempt.set(started.testCaseId, started);
    }

    const scenarios: ScenarioData[] = [];
    for (const [testCaseId, started] of finalAttempt) {
      const testCase = testCases.get(testCaseId);
      const pickle = testCase && pickles.get(testCase.pickleId);
      if (!testCase || !pickle) continue;

      const feature = featureNames.get(pickle.uri);
      // Unnamed scenarios are valid Gherkin: identify them by line so they stay distinct.
      const line = (pickle.astNodeIds ?? []).map((id: string) => astLines.get(id)).find((l: number | undefined) => l !== undefined);
      const title = pickle.name?.trim() || `(unnamed scenario${line ? `, line ${line}` : ''})`;
      const name = feature ? `${feature} › ${title}` : title;
      const tags = unique<string>((pickle.tags ?? []).map((t: any) => t.name));
      const results = stepResults.get(started.id) ?? new Map();

      const steps: any[] = testCase.testSteps ?? [];
      const firstPickleStep = steps.findIndex((s) => s.pickleStepId);
      const stepStatuses = steps.filter((s) => s.pickleStepId).map((s) => results.get(s.id)?.status ?? 'UNKNOWN');
      const hookFailed = steps.some((s) => s.hookId && results.get(s.id)?.status === 'FAILED');
      // Cucumber precedence: FAILED > AMBIGUOUS > UNDEFINED > PENDING > SKIPPED > PASSED.
      // Undefined/ambiguous steps make the scenario broken, not skipped.
      const failed = hookFailed || stepStatuses.some((s) => s === 'FAILED' || s === 'AMBIGUOUS' || s === 'UNDEFINED');
      const skipped = !failed && stepStatuses.some((s) => s === 'SKIPPED' || s === 'PENDING');
      const passed = !failed && !skipped && stepStatuses.every((s) => s === 'PASSED');

      const execs: HookExecution[] = [];
      steps.forEach((s, index) => {
        if (!s.hookId) return;
        const hook = hooks.get(s.hookId);
        const result = results.get(s.id);
        // No result at all (worker crashed / run aborted): outcome unknown, so don't record a run or a skip.
        if (!result) return;
        const status: string = result.status ?? 'UNKNOWN';
        const duration = toMs(result?.duration);
        const type: HookType = hook?.rawType ? hook.type : firstPickleStep === -1 || index < firstPickleStep ? 'before' : 'after';
        execs.push({
          hookName: hook?.hookName ?? `hook ${s.hookId}`,
          type,
          location: hook?.location,
          hookTags: hook?.hookTags,
          scenarioName: name,
          scenarioTags: tags,
          duration,
          passed: status === 'PASSED',
          error: status === 'FAILED' ? firstLine(result.message ?? result.exception?.message) : undefined,
          // A hook that returned 'skipped' still ran (and took time); one skipped after a failure did not.
          skipped: NOT_RUN.has(status) && duration === 0,
          scenarioSkipped: skipped,
          timestamp: toEpochMs(started.timestamp),
        });
      });

      const duration = steps.reduce((sum, s) => sum + toMs(results.get(s.id)?.duration), 0);
      scenarios.push({ name, id: pickle.id, tags, passed, skipped, hooks: execs, duration });
    }

    // Run-level hooks (BeforeAll/AfterAll), emitted by newer implementations.
    const runHookStarted = new Map<string, any>(of('testRunHookStarted').map((s) => [s.id, s]));
    const globalHooks: HookExecution[] = [];
    for (const finished of of('testRunHookFinished')) {
      const started = runHookStarted.get(finished.testRunHookStartedId);
      const hook = started && hooks.get(started.hookId);
      if (!hook) continue;
      const result = finished.result ?? finished.testStepResult;
      globalHooks.push({
        hookName: hook.hookName,
        type: hook.type,
        location: hook.location,
        scenarioName: '',
        scenarioTags: [],
        duration: toMs(result?.duration),
        passed: result?.status === 'PASSED',
        skipped: false,
        timestamp: toEpochMs(started.timestamp),
      });
    }

    // An aborted run (crashed workers, fail-fast, killed process) never executed most hooks:
    // reporting them as UNUSED would be wrong, so only declare hooks for complete runs.
    const warnings: string[] = [];
    const runFinished = of('testRunFinished')[0];
    const startedCases = new Set(of('testCaseStarted').map((s) => s.testCaseId)).size;
    const incomplete = !runFinished || !!runFinished.exception || startedCases < testCases.size;
    if (incomplete) {
      const reason = runFinished?.exception?.message ? `: ${String(runFinished.exception.message).split('\n')[0]}` : '';
      warnings.push(
        `The test run did not complete (${startedCases}/${testCases.size} test cases started${reason}). ` +
          'Registered hooks that never ran are not reported as UNUSED, since the run may have stopped before reaching them.',
      );
    }

    // Without run-hook messages we can't know whether BeforeAll/AfterAll ran, so don't declare them.
    const runHooksObservable = runHookStarted.size > 0;
    const declaredHooks: DeclaredHook[] = incomplete
      ? []
      : Array.from(hooks.values())
          .filter((h) => runHooksObservable || (h.type !== 'beforeAll' && h.type !== 'afterAll'))
          .map(({ rawType: _raw, ...h }) => h);

    const meta = of('meta')[0];
    return {
      framework: meta?.implementation?.name ? `cucumber (${meta.implementation.name} ${meta.implementation.version ?? ''})`.replace(' )', ')') : 'cucumber',
      scenarios,
      globalHooks,
      declaredHooks,
      warnings,
      metadata: { protocolVersion: meta?.protocolVersion },
    };
  }
}

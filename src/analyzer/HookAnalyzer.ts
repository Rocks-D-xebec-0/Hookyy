import type { AnalysisResult, Config, HookAnalysis, ParsedTestData, Severity } from '../types';
import { matchesHook } from '../utils';
import { hookInsights } from './insights';
import { BaseRule, defaultRules } from './rules';
import { runRules } from './validator';

export class HookAnalyzer {
  private readonly rules: BaseRule[];

  constructor(private readonly config: Config, rules: BaseRule[] = defaultRules()) {
    this.rules = rules;
  }

  addRule(rule: BaseRule): this {
    this.rules.push(rule);
    return this;
  }

  analyze(data: ParsedTestData): AnalysisResult {
    const started = Date.now();
    const hooks = this.groupHooks(data);
    const rootDir = this.config.rootDir ?? process.cwd();
    for (const hook of hooks.values()) hook.insights = hookInsights(hook, rootDir);
    const issues = runRules(this.rules, { hooks, data, config: this.config });

    for (const issue of issues) hooks.get(issue.hookName)?.issues.push(issue);

    const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
    return {
      framework: data.framework,
      summary: {
        totalTestTime:
          data.scenarios.reduce((sum, s) => sum + (s.duration ?? 0), 0) +
          (data.globalHooks ?? []).reduce((sum, h) => sum + h.duration, 0),
        totalHookTime: Array.from(hooks.values()).reduce((sum, h) => sum + h.totalDuration, 0),
        totalHooks: hooks.size,
        totalScenarios: data.scenarios.length,
        totalExecutions: Array.from(hooks.values()).reduce((n, h) => n + h.executions.length, 0),
        issuesFound: issues.length,
        errorCount: count('error'),
        warningCount: count('warning'),
        infoCount: count('info'),
      },
      hooks,
      issues,
      warnings: data.scenarios.length === 0 && !(data.warnings ?? []).length
        ? ['The report contains no scenarios. Did the run fail before any test started (e.g. in a BeforeAll/setup hook), or were all tests filtered out?']
        : data.warnings ?? [],
      executionTime: Date.now() - started,
    };
  }

  private groupHooks(data: ParsedTestData): Map<string, HookAnalysis> {
    const ignore = this.config.ignore ?? [];
    const tagOverrides = Object.entries(this.config.hookTags ?? {});
    const hooks = new Map<string, HookAnalysis>();

    const perScenario = data.scenarios.flatMap((scenario) =>
      scenario.hooks.map((exec) => ({ ...exec, scenarioSkipped: exec.scenarioSkipped ?? scenario.skipped })),
    );
    const global = (data.globalHooks ?? []).map((exec) => ({ ...exec, scenarioSkipped: false }));

    for (const exec of [...perScenario, ...global]) {
      if (ignore.some((p) => matchesHook(p, exec.hookName, exec.location))) continue;
      let hook = hooks.get(exec.hookName);
      if (!hook) {
        const override = tagOverrides.find(([p]) => matchesHook(p, exec.hookName, exec.location));
        hook = {
          name: exec.hookName,
          type: exec.type,
          location: exec.location,
          hookTags: override ? override[1] : exec.hookTags,
          executions: [],
          scenariosAffected: new Set(),
          avgDuration: 0,
          medianDuration: 0,
          maxDuration: 0,
          totalDuration: 0,
          insights: [],
          issues: [],
        };
        hooks.set(exec.hookName, hook);
      }
      hook.executions.push(exec);
      if (exec.scenarioName) hook.scenariosAffected.add(exec.scenarioName);
    }

    // Registered hooks that never appear in any execution: keep them so UNUSED can report them.
    for (const declared of data.declaredHooks ?? []) {
      if (hooks.has(declared.hookName)) continue;
      if (ignore.some((p) => matchesHook(p, declared.hookName, declared.location))) continue;
      const override = tagOverrides.find(([p]) => matchesHook(p, declared.hookName, declared.location));
      hooks.set(declared.hookName, {
        name: declared.hookName,
        type: declared.type,
        location: declared.location,
        hookTags: override ? override[1] : declared.hookTags,
        executions: [],
        scenariosAffected: new Set(),
        avgDuration: 0,
        medianDuration: 0,
        maxDuration: 0,
        totalDuration: 0,
        insights: [],
        issues: [],
      });
    }

    for (const hook of hooks.values()) {
      const ran = hook.executions.filter((e) => !e.skipped);
      hook.totalDuration = ran.reduce((sum, e) => sum + e.duration, 0);
      hook.avgDuration = ran.length ? hook.totalDuration / ran.length : 0;
      hook.maxDuration = ran.reduce((max, e) => Math.max(max, e.duration), 0);
      hook.medianDuration = median(ran.map((e) => e.duration));
    }
    return hooks;
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

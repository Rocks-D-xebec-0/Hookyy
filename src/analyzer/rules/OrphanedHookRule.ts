import type { HookIssue } from '../../types';
import { BaseRule, RuleContext } from './BaseRule';

/** A hook that executed, but only ever for scenarios that were skipped. */
export class OrphanedHookRule extends BaseRule {
  readonly code = 'ORPHANED' as const;
  readonly configKey = 'orphaned' as const;
  readonly description = 'Hooks that only run for skipped scenarios';

  check(context: RuleContext): HookIssue[] {
    const issues: HookIssue[] = [];
    for (const hook of context.hooks.values()) {
      const ran = hook.executions.filter((e) => !e.skipped);
      if (ran.length === 0) continue;
      if (!ran.every((e) => e.scenarioSkipped)) continue;

      const scenarios = Array.from(new Set(ran.map((e) => e.scenarioName)));
      const wasted = ran.reduce((sum, e) => sum + e.duration, 0);
      issues.push(
        this.issue(
          context,
          hook.name,
          `Hook ran ${ran.length} time(s) but every scenario it ran for was skipped (${scenarios.length} scenario(s), ${Math.round(wasted)}ms wasted).`,
          'Scope the hook with a tag expression that excludes skipped/WIP scenarios, or remove it if those scenarios are dead.',
          scenarios.map((scenario) => ({ scenario })),
        ),
      );
    }
    return issues;
  }
}

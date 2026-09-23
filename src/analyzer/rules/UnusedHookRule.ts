import type { HookIssue } from '../../types';
import { matchesHook } from '../../utils';
import { BaseRule, RuleContext } from './BaseRule';

/**
 * A hook that never actually executed:
 *  - registered by the framework (Cucumber Messages) but never run for any scenario,
 *  - present in the report but skipped every time, or
 *  - listed in `expectedHooks` but absent entirely.
 */
export class UnusedHookRule extends BaseRule {
  readonly code = 'UNUSED' as const;
  readonly configKey = 'unused' as const;
  readonly description = 'Hooks that never executed';

  check(context: RuleContext): HookIssue[] {
    const issues: HookIssue[] = [];

    for (const hook of context.hooks.values()) {
      if (hook.executions.length === 0) {
        issues.push(
          this.issue(
            context,
            hook.name,
            hook.hookTags
              ? `Hook is registered with tags "${hook.hookTags}" but no scenario in this run matched them; it never ran.`
              : 'Hook is registered but never ran for any scenario in this run.',
            'Delete it if the tagged scenarios are gone, or fix the tag expression. If it only targets scenarios excluded from this run (e.g. @debug), add it to "ignore".',
            [{ declared: hook.location ?? hook.name }],
          ),
        );
        continue;
      }
      if (hook.executions.some((e) => !e.skipped)) continue;
      issues.push(
        this.issue(
          context,
          hook.name,
          `Hook is attached to ${hook.scenariosAffected.size} scenario(s) but was skipped every time; it never ran.`,
          'Check whether an earlier hook or step fails before it, or whether its tag scope is wrong. Remove it if it is no longer needed.',
          hook.executions.map((e) => ({ scenario: e.scenarioName })),
        ),
      );
    }

    const hooks = Array.from(context.hooks.values());
    for (const expected of context.config.expectedHooks ?? []) {
      if (hooks.some((h) => h.executions.length > 0 && matchesHook(expected, h.name, h.location))) continue;
      if (hooks.some((h) => h.executions.length === 0 && matchesHook(expected, h.name, h.location))) continue; // already reported above
      issues.push(
        this.issue(
          context,
          expected,
          'Expected hook never appeared in the report; it did not run for any scenario.',
          'Delete the hook if it is dead code, or fix its tag expression / registration so it matches scenarios.',
          [{ expected }],
        ),
      );
    }
    return issues;
  }
}

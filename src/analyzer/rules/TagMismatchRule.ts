import type { HookIssue } from '../../types';
import { parseTagExpression, TagPredicate } from '../../utils';
import { BaseRule, RuleContext } from './BaseRule';

/**
 * A hook bound to a tag expression (read from source, or declared in
 * `hookTags` config) that ran for scenarios whose tags don't satisfy it.
 */
export class TagMismatchRule extends BaseRule {
  readonly code = 'TAG_MISMATCH' as const;
  readonly configKey = 'tagMismatch' as const;
  readonly description = "Hooks whose tag expression doesn't match the scenarios they ran on";

  check(context: RuleContext): HookIssue[] {
    const issues: HookIssue[] = [];

    for (const hook of context.hooks.values()) {
      if (!hook.hookTags) continue;
      let predicate: TagPredicate;
      try {
        predicate = parseTagExpression(hook.hookTags);
      } catch {
        continue;
      }

      const mismatched = hook.executions.filter((e) => !e.skipped && !predicate(e.scenarioTags));
      if (mismatched.length === 0) continue;

      const seen = new Set<string>();
      const evidence = mismatched
        .filter((e) => (seen.has(e.scenarioName) ? false : (seen.add(e.scenarioName), true)))
        .map((e) => ({ scenario: e.scenarioName, tags: e.scenarioTags }));

      issues.push(
        this.issue(
          context,
          hook.name,
          `Hook is scoped to "${hook.hookTags}" but ran for ${evidence.length} scenario(s) whose tags don't match.`,
          'Align the hook tag expression with the scenarios that need it, or fix the scenario tags. Note: tags are inherited from the Feature.',
          evidence,
        ),
      );
    }
    return issues;
  }
}

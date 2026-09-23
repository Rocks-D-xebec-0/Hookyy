import type { HookIssue } from '../types';
import { SEVERITY_RANK } from '../utils';
import type { BaseRule, RuleContext } from './rules';

/** Run every enabled rule and return issues sorted by severity, then hook name. */
export function runRules(rules: BaseRule[], context: RuleContext): HookIssue[] {
  const issues: HookIssue[] = [];
  for (const rule of rules) {
    const settings = context.config.rules[rule.configKey];
    if (settings && settings.enabled === false) continue;
    issues.push(...rule.check(context));
  }
  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.hookName.localeCompare(b.hookName, undefined, { numeric: true }) ||
      a.code.localeCompare(b.code),
  );
}

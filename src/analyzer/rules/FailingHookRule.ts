import type { HookExecution, HookIssue } from '../../types';
import { BaseRule, RuleContext } from './BaseRule';

/**
 * A hook that failed (threw) in at least one run. A broken After hook often hides the real test
 * failure (field test: an After hook calling page.screenshot() on a page that was never created).
 */
export class FailingHookRule extends BaseRule {
  readonly code = 'FAILING' as const;
  readonly configKey = 'failing' as const;
  readonly description = 'Hooks that threw an error';

  check(context: RuleContext): HookIssue[] {
    const issues: HookIssue[] = [];
    for (const hook of context.hooks.values()) {
      const ran = hook.executions.filter((e) => !e.skipped);
      const failed = ran.filter((e) => !e.passed);
      if (!failed.length) continue;
      const isAfter = hook.type === 'after' || hook.type === 'afterAll';
      issues.push(
        this.issue(
          context,
          hook.name,
          `Hook failed in ${failed.length}/${ran.length} run(s).`,
          isAfter
            ? 'Fix or guard the teardown: a failing after-hook can mask the real test failure (e.g. only take a screenshot when the page exists).'
            : 'Fix the setup: when a before-hook fails, every step of the scenario is skipped and the test result is misleading.',
          // One entry per distinct error (with the first scenario it happened in), then any other scenarios.
          distinctFailures(failed),
        ),
      );
    }
    return issues;
  }
}

function distinctFailures(failed: HookExecution[]): Array<{ scenario: string; error?: string }> {
  const byError = new Map<string, { scenario: string; error?: string }>();
  for (const e of failed) {
    const key = e.error ?? '';
    if (!byError.has(key)) byError.set(key, { scenario: e.scenarioName || '(test run)', error: e.error });
  }
  return Array.from(byError.values());
}

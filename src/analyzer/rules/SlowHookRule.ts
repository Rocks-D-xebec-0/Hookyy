import type { HookIssue } from '../../types';
import { formatMs, round } from '../../utils';
import { recommendationFor } from '../insights';
import { BaseRule, RuleContext } from './BaseRule';

/**
 * A hook whose duration exceeds `rules.slow.threshold` ms.
 *
 * `rules.slow.metric` picks what is compared to the threshold:
 *  - `median` (default): the typical run. Cold starts (first browser launch,
 *    first-run browser download, first login) don't distort it. Field data:
 *    one 115 s first run pushed a 3 s hook's average to 23 s.
 *  - `avg`: the average run, for hooks where every second counts in total.
 *  - `max`: any single run over the threshold (strict budgets).
 */
export class SlowHookRule extends BaseRule {
  readonly code = 'SLOW' as const;
  readonly configKey = 'slow' as const;
  readonly description = 'Hooks exceeding the duration threshold';

  check(context: RuleContext): HookIssue[] {
    const { threshold, metric = 'median' } = context.config.rules.slow;
    const issues: HookIssue[] = [];

    for (const hook of context.hooks.values()) {
      const ran = hook.executions.filter((e) => !e.skipped);
      if (ran.length === 0) continue;
      const measured = metric === 'max' ? hook.maxDuration : metric === 'avg' ? hook.avgDuration : hook.medianDuration;
      if (measured <= threshold) continue;

      const slow = ran.filter((e) => e.duration > threshold);
      const overhead = slow.reduce((sum, e) => sum + (e.duration - threshold), 0);
      issues.push(
        this.issue(
          context,
          hook.name,
          `${metric === 'max' ? 'Slowest run' : metric === 'avg' ? 'Average run' : 'Typical (median) run'} exceeds ${formatMs(threshold)}: ` +
            `median ${formatMs(hook.medianDuration)}, avg ${formatMs(hook.avgDuration)}, max ${formatMs(hook.maxDuration)}; ` +
            `${slow.length}/${ran.length} run(s) over budget (${formatMs(overhead)} in total).`,
          recommendationFor(
            hook,
            hook.type === 'before' || hook.type === 'after'
              ? 'Move expensive setup to a BeforeAll/worker-scoped fixture, reuse auth state instead of logging in through the UI, or seed data via API.'
              : 'Profile the hook; consider parallelising or caching the expensive work.',
          ),
          slow
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)
            .map((e) => ({ scenario: e.scenarioName, duration: round(e.duration) })),
        ),
      );
    }
    return issues;
  }
}

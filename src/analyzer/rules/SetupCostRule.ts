import type { HookIssue } from '../../types';
import { formatMs, round } from '../../utils';
import { recommendationFor } from '../insights';
import { BaseRule, RuleContext } from './BaseRule';

/** Below this total, a large share of a small suite isn't worth reporting. */
const MIN_TOTAL_FOR_SHARE_MS = 5000;

/**
 * A per-scenario hook that is individually fast enough but expensive in total: 700 ms × 300 tests is
 * 3.5 minutes per run, and SLOW (per-run) never sees it.
 *
 * Fires when the hook ran at least `minRuns` times and its total time is at least `minTotal` ms or
 * at least `minShare` of the whole run's test time (the share test needs 5 s of hook time, so a
 * share of a tiny suite isn't reported). Hooks SLOW already reports are skipped, so each
 * hook gets one finding.
 */
export class SetupCostRule extends BaseRule {
  readonly code = 'SETUP_COST' as const;
  readonly configKey = 'cost' as const;
  readonly description = 'Per-scenario hooks that add up to a large share of the run';

  check(context: RuleContext): HookIssue[] {
    const { minTotal, minShare, minRuns } = context.config.rules.cost;
    const slow = context.config.rules.slow;
    const totalTestTime =
      context.data.scenarios.reduce((sum, s) => sum + (s.duration ?? 0), 0) +
      (context.data.globalHooks ?? []).reduce((sum, h) => sum + h.duration, 0);
    const issues: HookIssue[] = [];

    for (const hook of context.hooks.values()) {
      if (hook.type !== 'before' && hook.type !== 'after') continue;
      const ran = hook.executions.filter((e) => !e.skipped);
      if (ran.length < minRuns) continue;

      // Already reported by SLOW (same metric logic), so don't double-report.
      if (slow.enabled !== false) {
        const measured = slow.metric === 'max' ? hook.maxDuration : slow.metric === 'avg' ? hook.avgDuration : hook.medianDuration;
        if (measured > slow.threshold) continue;
      }

      const share = totalTestTime > 0 ? hook.totalDuration / totalTestTime : 0;
      const bigShare = share >= minShare && hook.totalDuration >= MIN_TOTAL_FOR_SHARE_MS;
      if (hook.totalDuration < minTotal && !bigShare) continue;

      issues.push(
        this.issue(
          context,
          hook.name,
          `Adds ${formatMs(hook.totalDuration)} per run across ${ran.length} scenarios` +
            (share > 0 ? ` (${Math.round(share * 100)}% of total test time)` : '') +
            `, at a typical ${formatMs(hook.medianDuration)} each.`,
          recommendationFor(
            hook,
            'Run this work once per worker (BeforeAll or a worker-scoped fixture) instead of before every scenario, or scope it with tags to the scenarios that need it.',
          ),
          [{ runs: ran.length, total: round(hook.totalDuration), share: round(share, 3) }],
        ),
      );
    }
    return issues;
  }
}

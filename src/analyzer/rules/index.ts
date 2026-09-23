import { BaseRule } from './BaseRule';
import { FailingHookRule } from './FailingHookRule';
import { OrphanedHookRule } from './OrphanedHookRule';
import { SetupCostRule } from './SetupCostRule';
import { SlowHookRule } from './SlowHookRule';
import { TagMismatchRule } from './TagMismatchRule';
import { UnusedHookRule } from './UnusedHookRule';

export { BaseRule, FailingHookRule, OrphanedHookRule, UnusedHookRule, SlowHookRule, SetupCostRule, TagMismatchRule };
export type { RuleContext } from './BaseRule';

export function defaultRules(): BaseRule[] {
  return [new FailingHookRule(), new OrphanedHookRule(), new UnusedHookRule(), new SlowHookRule(), new SetupCostRule(), new TagMismatchRule()];
}

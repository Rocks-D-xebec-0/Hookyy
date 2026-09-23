import type { Config, HookAnalysis, HookIssue, IssueCode, ParsedTestData, RuleConfig, Severity } from '../../types';

export interface RuleContext {
  hooks: Map<string, HookAnalysis>;
  data: ParsedTestData;
  config: Config;
}

/**
 * Extend this class to add a rule. `check()` returns every issue found; the
 * validator takes care of enablement, severity overrides and bookkeeping.
 */
export abstract class BaseRule {
  abstract readonly code: IssueCode;
  /** Key under `config.rules` holding this rule's settings. */
  abstract readonly configKey: keyof Config['rules'];
  abstract readonly description: string;

  abstract check(context: RuleContext): HookIssue[];

  protected settings(context: RuleContext): RuleConfig & Record<string, unknown> {
    return context.config.rules[this.configKey] as RuleConfig & Record<string, unknown>;
  }

  protected severity(context: RuleContext): Severity {
    return this.settings(context).severity;
  }

  protected issue(
    context: RuleContext,
    hookName: string,
    message: string,
    recommendation: string,
    evidence: any[] = [],
  ): HookIssue {
    return { severity: this.severity(context), code: this.code, hookName, message, recommendation, evidence };
  }
}

export type HookType = 'before' | 'after' | 'beforeAll' | 'afterAll';
export type Severity = 'error' | 'warning' | 'info';
export type IssueCode = 'FAILING' | 'ORPHANED' | 'UNUSED' | 'SLOW' | 'SETUP_COST' | 'TAG_MISMATCH';
export type SlowMetric = 'median' | 'avg' | 'max';
export type ReporterType = 'cli' | 'html' | 'json' | 'markdown';

export interface HookExecution {
  /** Stable identifier for the hook, e.g. its source location or title. */
  hookName: string;
  type: HookType;
  scenarioName: string;
  scenarioTags: string[];
  /** Duration in milliseconds. */
  duration: number;
  passed: boolean;
  /** True when the hook itself did not run (e.g. skipped after an earlier failure). */
  skipped: boolean;
  timestamp?: number;
  /** Source location of the hook (file:line), when the report provides it. */
  location?: string;
  /** Tag expression the hook is bound to, when known (from source or config). */
  hookTags?: string;
  /** First line of the error, when the hook failed. */
  error?: string;
  /** True when the scenario this execution belongs to was skipped. */
  scenarioSkipped?: boolean;
}

export interface HookIssue {
  severity: Severity;
  code: IssueCode;
  hookName: string;
  message: string;
  recommendation: string;
  evidence: any[];
}

export interface AnalysisSummary {
  /** Sum of scenario durations plus run-level hooks, in ms (0 when the report has no timings). */
  totalTestTime: number;
  /** Time spent in hooks that actually ran, in ms. */
  totalHookTime: number;
  totalHooks: number;
  totalScenarios: number;
  totalExecutions: number;
  issuesFound: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface AnalysisResult {
  framework: string;
  summary: AnalysisSummary;
  hooks: Map<string, HookAnalysis>;
  issues: HookIssue[];
  /** Input limitations reported by the parser. */
  warnings: string[];
  /** Analysis time in milliseconds. */
  executionTime: number;
}

export interface HookAnalysis {
  name: string;
  type: HookType;
  location?: string;
  hookTags?: string;
  executions: HookExecution[];
  scenariosAffected: Set<string>;
  avgDuration: number;
  medianDuration: number;
  maxDuration: number;
  totalDuration: number;
  /** What the hook does, recognised from its source (empty when the source isn't available). */
  insights: HookInsight[];
  issues: HookIssue[];
}

export interface HookInsight {
  kind: 'browser-launch' | 'ui-login' | 'navigation' | 'tracing' | 'data-setup' | 'fixed-wait';
  label: string;
  fix: string;
}

export interface RuleConfig {
  enabled: boolean;
  severity: Severity;
}

export interface Config {
  rules: {
    failing: RuleConfig;
    orphaned: RuleConfig;
    unused: RuleConfig;
    slow: RuleConfig & { threshold: number; metric?: SlowMetric };
    /** Per-scenario hooks that are cheap per run but expensive in total. */
    cost: RuleConfig & { minTotal: number; minShare: number; minRuns: number };
    tagMismatch: RuleConfig;
  };
  reporters: ReporterConfig[];
  /**
   * Hooks you expect to exist (names or locations). Any that never appear in
   * the report are flagged as UNUSED.
   */
  expectedHooks?: string[];
  /**
   * Tag expressions per hook (name/location substring -> expression). Used by
   * the TAG_MISMATCH rule when the report doesn't carry hook tags.
   */
  hookTags?: Record<string, string>;
  /** Hook names/locations (substring match) to ignore entirely. */
  ignore?: string[];
  /** Base directory used to resolve hook source files. Defaults to cwd. */
  rootDir?: string;
}

export interface ReporterConfig {
  type: ReporterType;
  output?: string;
  verbose?: boolean;
}

export interface ParsedTestData {
  framework: string;
  scenarios: ScenarioData[];
  /** Run-level hooks (BeforeAll/AfterAll) that don't belong to a single scenario. */
  globalHooks?: HookExecution[];
  /**
   * Every hook the framework registered, whether or not it ran (e.g. from
   * Cucumber Messages). Declared hooks with no executions are UNUSED.
   */
  declaredHooks?: DeclaredHook[];
  /** Limitations of the input the user should know about (shown by every reporter). */
  warnings?: string[];
  metadata?: any;
}

export interface DeclaredHook {
  hookName: string;
  type: HookType;
  location?: string;
  hookTags?: string;
}

export interface ScenarioData {
  name: string;
  id?: string;
  tags: string[];
  passed: boolean;
  skipped: boolean;
  hooks: HookExecution[];
  duration?: number;
}

/** Deep-partial config as accepted from YAML files / API callers. */
export type PartialConfig = {
  rules?: {
    [K in keyof Config['rules']]?: Partial<Config['rules'][K]>;
  };
} & Partial<Omit<Config, 'rules'>>;

import * as path from 'path';
import { HookAnalyzer } from './analyzer/HookAnalyzer';
import type { BaseRule } from './analyzer/rules';
import { loadConfig, mergeConfig, validateConfig } from './config/ConfigLoader';
import { defaultConfig } from './config/DefaultConfig';
import { detectParser, getParser } from './parsers';
import { createReporter } from './reporters';
import type { AnalysisResult, Config, ParsedTestData, PartialConfig, ReporterConfig, Severity } from './types';
import { expandReportPaths, readJsonFile, SEVERITY_RANK, writeOutputFile } from './utils';

export * from './types';
export { HookAnalyzer } from './analyzer/HookAnalyzer';
export { runRules } from './analyzer/validator';
export * from './analyzer/rules';
export * from './parsers';
export * from './reporters';
export { loadConfig, findConfigFile, mergeConfig, validateConfig } from './config/ConfigLoader';
export { defaultConfig, CONFIG_FILE_NAMES } from './config/DefaultConfig';
export { HookyyError, parseTagExpression, readHookTagsFromSource } from './utils';
export { VERSION } from './reporters/serialize';

export interface AnalyzeOptions {
  /** Path to the report. Either this, `reportPaths` or `data` is required. */
  reportPath?: string;
  /**
   * Several reports (e.g. one per worker or shard) analyzed as one run. Entries may be
   * files, directories (every .json/.ndjson inside) or basename wildcards like `reports/*.ndjson`.
   */
  reportPaths?: string[];
  /** Already-parsed report JSON. */
  data?: unknown;
  /** Parser name; auto-detected per file when omitted. */
  parser?: string;
  /** Path to a YAML config file; auto-discovered in cwd when omitted. */
  configPath?: string;
  /** Inline config, merged over the file config. */
  config?: PartialConfig;
  /** Extra custom rules to run alongside the built-in ones. */
  rules?: BaseRule[];
  cwd?: string;
}

export interface AnalyzeOutput {
  result: AnalysisResult;
  config: Config;
  parser: string;
  configSource?: string;
}

/** Parse a report and run all enabled rules. */
export function analyze(options: AnalyzeOptions): AnalyzeOutput {
  const cwd = options.cwd ?? process.cwd();
  const loaded = options.configPath !== undefined || !options.config ? loadConfig(options.configPath, cwd) : { config: defaultConfig() };
  const config = options.config ? mergeConfig(loaded.config, validateConfig(options.config, 'inline config')) : loaded.config;
  const rootDir = config.rootDir ?? cwd;

  const inputs: unknown[] =
    options.data !== undefined
      ? [options.data]
      : expandReportPaths(options.reportPaths ?? [options.reportPath ?? ''], cwd).map((file) => readJsonFile(file));

  const parserNames = new Set<string>();
  const parsed = mergeParsed(
    inputs.map((data) => {
      const parser = options.parser ? getParser(options.parser) : detectParser(data);
      parserNames.add(parser.name);
      return parser.parse(data, { rootDir });
    }),
  );

  const analyzer = new HookAnalyzer(config);
  for (const rule of options.rules ?? []) analyzer.addRule(rule);

  return {
    result: analyzer.analyze(parsed),
    config,
    parser: Array.from(parserNames).join(', '),
    configSource: 'source' in loaded ? loaded.source : undefined,
  };
}

export interface ReportOutput {
  type: string;
  /** Absolute path written to, when `output` was set. */
  file?: string;
  content: string;
}

/**
 * Render the result with each reporter. Reporters with an `output` path are
 * written to disk; the rest are returned for the caller to print.
 */
export function report(result: AnalysisResult, reporters: ReporterConfig[], opts: { verbose?: boolean; color?: boolean; cwd?: string } = {}): ReportOutput[] {
  return reporters.map((rc) => {
    const reporter = createReporter(rc.type);
    const verbose = rc.verbose ?? opts.verbose;
    const content = reporter.render(result, { verbose, color: rc.output ? false : opts.color });
    if (!rc.output) return { type: rc.type, content };
    const file = writeOutputFile(path.resolve(opts.cwd ?? process.cwd(), rc.output), content);
    return { type: rc.type, file, content };
  });
}

/** True if any issue is at or above the lowest of the given severities. */
export function shouldFail(result: AnalysisResult, failOn: Severity[]): boolean {
  if (!failOn.length) return false;
  const min = Math.min(...failOn.map((s) => SEVERITY_RANK[s]));
  return result.issues.some((i) => SEVERITY_RANK[i.severity] >= min);
}

/** Combine per-file results (one per worker/shard/spec) into a single run. */
export function mergeParsed(parts: ParsedTestData[]): ParsedTestData {
  if (parts.length === 1) return parts[0];
  const declared = new Map<string, NonNullable<ParsedTestData['declaredHooks']>[number]>();
  for (const p of parts) for (const d of p.declaredHooks ?? []) if (!declared.has(d.hookName)) declared.set(d.hookName, d);
  return {
    framework: Array.from(new Set(parts.map((p) => p.framework))).join(', '),
    scenarios: parts.flatMap((p) => p.scenarios),
    globalHooks: parts.flatMap((p) => p.globalHooks ?? []),
    declaredHooks: Array.from(declared.values()),
    warnings: Array.from(new Set(parts.flatMap((p) => p.warnings ?? []))),
    metadata: { files: parts.length },
  };
}

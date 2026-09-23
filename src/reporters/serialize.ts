import type { AnalysisResult, HookAnalysis, HookIssue, AnalysisSummary, HookType } from '../types';
import { round } from '../utils';

export interface SerializedHook {
  name: string;
  type: HookType;
  location?: string;
  hookTags?: string;
  executions: number;
  scenariosAffected: string[];
  avgDuration: number;
  medianDuration: number;
  maxDuration: number;
  totalDuration: number;
  issues: HookIssue['code'][];
  insights: string[];
}

export interface SerializedResult {
  tool: 'hookyy';
  version: string;
  generatedAt: string;
  framework: string;
  summary: AnalysisSummary;
  warnings: string[];
  issues: HookIssue[];
  hooks: SerializedHook[];
  executionTime: number;
}

declare const __HOOKYY_VERSION__: string | undefined;
export const VERSION: string = typeof __HOOKYY_VERSION__ === 'string' ? __HOOKYY_VERSION__ : '0.0.0-dev';

/** Convert the Map/Set-based result into a plain JSON-safe object. */
export function serializeResult(result: AnalysisResult, verbose = true): SerializedResult {
  const hooks = Array.from(result.hooks.values())
    .map(
      (h): SerializedHook => ({
        name: h.name,
        type: h.type,
        location: h.location,
        hookTags: h.hookTags,
        executions: h.executions.length,
        scenariosAffected: verbose ? Array.from(h.scenariosAffected) : [],
        avgDuration: round(h.avgDuration),
        medianDuration: round(h.medianDuration),
        maxDuration: round(h.maxDuration),
        totalDuration: round(h.totalDuration),
        issues: h.issues.map((i) => i.code),
        insights: h.insights.map((i) => i.label),
      }),
    )
    .sort((a, b) => b.totalDuration - a.totalDuration);

  return {
    tool: 'hookyy',
    version: VERSION,
    generatedAt: new Date().toISOString(),
    framework: result.framework,
    summary: result.summary,
    warnings: result.warnings ?? [],
    issues: result.issues,
    hooks,
    executionTime: result.executionTime,
  };
}

/** The most expensive hooks by total run time (hooks that took no measurable time are left out). */
export function topHooks(result: AnalysisResult, n = 3): HookAnalysis[] {
  return Array.from(result.hooks.values())
    .filter((h) => h.totalDuration >= 1)
    .sort((a, b) => b.totalDuration - a.totalDuration)
    .slice(0, n);
}

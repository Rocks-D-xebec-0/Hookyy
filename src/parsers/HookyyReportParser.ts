import type { ParsedTestData } from '../types';
import { HookyyError } from '../utils';
import { BaseParser } from './BaseParser';

/**
 * Reads Hookyy's native report format, written by `hookyy/playwright-reporter`
 * (and usable by anyone writing their own adapter): ParsedTestData plus a
 * `hookyyReport` version marker.
 */
export class HookyyReportParser extends BaseParser {
  readonly name = 'hookyy';
  readonly aliases = ['native', 'playwright-hookyy'];

  detect(data: unknown): boolean {
    return !!data && typeof data === 'object' && !Array.isArray(data) && 'hookyyReport' in data;
  }

  parse(data: unknown): ParsedTestData {
    if (!this.detect(data)) throw new HookyyError('Not a Hookyy report (missing "hookyyReport").');
    const r = data as Partial<ParsedTestData> & { hookyyReport: number };
    if (r.hookyyReport !== 1) {
      throw new HookyyError(`Unsupported Hookyy report version ${r.hookyyReport}.`, 'Upgrade hookyy to read this report.');
    }
    if (!Array.isArray(r.scenarios)) throw new HookyyError('Hookyy report has no "scenarios" array.');
    return {
      framework: r.framework ?? 'unknown',
      scenarios: r.scenarios,
      globalHooks: r.globalHooks ?? [],
      declaredHooks: r.declaredHooks ?? [],
      warnings: r.warnings ?? [],
    };
  }
}

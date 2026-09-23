import type { ParsedTestData, ScenarioData } from '../types';
import { HookyyError, unique } from '../utils';
import { BaseParser, ParserOptions } from './BaseParser';

interface PwResult {
  status?: string;
  duration?: number;
}

interface PwTest {
  projectName?: string;
  status?: string;
  results?: PwResult[];
}

interface PwSpec {
  title: string;
  file?: string;
  line?: number;
  tags?: string[];
  tests?: PwTest[];
}

interface PwSuite {
  title: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

interface PwReport {
  config?: { projects?: unknown[]; version?: string };
  suites?: PwSuite[];
  stats?: unknown;
}

const TAG_IN_TITLE = /(^|\s)(@[\w:-]+)/g;

export const PLAYWRIGHT_JSON_WARNING =
  "Playwright's JSON reporter does not include hook steps, so no hooks can be audited from this file. " +
  'Run with the Hookyy reporter instead (no test changes needed): ' +
  'npx playwright test --reporter=list,hookyy/playwright-reporter, then: hookyy analyze hookyy-playwright.json';

/**
 * Recognises Playwright's built-in JSON reporter output (`--reporter=json`).
 *
 * That reporter only serializes `test.step` steps: hooks (category "hook")
 * are never written, in any Playwright version. We still read the scenarios so
 * the user gets a clear explanation instead of a silent "no hooks".
 * For real hook data use `hookyy/playwright-reporter` (HookyyReportParser).
 */
export class PlaywrightParser extends BaseParser {
  readonly name = 'playwright';
  readonly aliases = ['pw', 'playwright-json'];

  detect(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const r = data as PwReport;
    return Array.isArray(r.suites) && (r.config !== undefined || r.stats !== undefined);
  }

  parse(data: unknown, _options: ParserOptions = {}): ParsedTestData {
    if (!this.detect(data)) {
      throw new HookyyError('Not a Playwright JSON report.', 'Generate it with `playwright test --reporter=json`.');
    }
    const report = data as PwReport;
    const multiProject = (report.config?.projects?.length ?? 0) > 1;
    const scenarios: ScenarioData[] = [];

    const walk = (suite: PwSuite, titlePath: string[], file: string | undefined) => {
      const currentFile = suite.file ?? file;
      const titles = suite.title && suite.title !== currentFile ? [...titlePath, suite.title] : titlePath;
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) scenarios.push(this.parseTest(spec, test, titles, multiProject));
      }
      for (const child of suite.suites ?? []) walk(child, titles, currentFile);
    };
    for (const suite of report.suites ?? []) walk(suite, [], undefined);

    return {
      framework: report.config?.version ? `playwright ${report.config.version} (JSON reporter)` : 'playwright (JSON reporter)',
      scenarios,
      warnings: [PLAYWRIGHT_JSON_WARNING],
    };
  }

  private parseTest(spec: PwSpec, test: PwTest, titlePath: string[], multiProject: boolean): ScenarioData {
    const baseName = [...titlePath, spec.title].join(' › ');
    const name = multiProject && test.projectName ? `${baseName} [${test.projectName}]` : baseName;
    const titleTags = [...titlePath, spec.title].flatMap((t) => Array.from(t.matchAll(TAG_IN_TITLE), (m) => m[2]));
    const tags = unique([...(spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)), ...titleTags]);

    const results = test.results ?? [];
    const last = results[results.length - 1];
    const skipped = test.status === 'skipped' || last?.status === 'skipped';
    const passed = !skipped && (test.status === 'expected' || test.status === 'flaky');
    const duration = results.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    return { name, id: spec.file && spec.line ? `${spec.file}:${spec.line}` : undefined, tags, passed, skipped, hooks: [], duration };
  }
}

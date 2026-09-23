import * as fs from 'fs';
import * as path from 'path';
import type { HookExecution, HookType, ScenarioData } from '../types';

/*
 * Playwright's built-in JSON reporter only serializes `test.step` steps, so
 * hook timings never reach it. This reporter records every hook step (with its
 * source location) through the public Reporter API and writes a report that
 * `hookyy analyze` reads directly.
 *
 *   npx playwright test --reporter=list,hookyy/playwright-reporter
 *
 * Options: { outputFile?: string } (default: hookyy-playwright.json), or the
 * HOOKYY_OUTPUT_FILE environment variable.
 */

// Minimal structural types so we don't depend on @playwright/test at runtime.
interface Location {
  file: string;
  line: number;
  column?: number;
}
interface TestStep {
  title: string;
  category: string;
  duration: number;
  location?: Location;
  error?: unknown;
  parent?: TestStep;
}
interface TestResult {
  status: string;
  startTime?: Date;
  duration: number;
  retry?: number;
}
interface Suite {
  title: string;
  parent?: Suite;
}
interface TestCase {
  id: string;
  title: string;
  tags?: string[];
  titlePath?(): string[];
  parent?: Suite;
}
interface FullConfig {
  rootDir: string;
  configFile?: string;
  version?: string;
  projects?: Array<{ name?: string }>;
}

export interface HookyyReporterOptions {
  outputFile?: string;
}

const GROUP_TITLES = new Set(['Before Hooks', 'After Hooks', 'Worker Cleanup']);
const TAG_IN_TITLE = /(^|\s)(@[\w:-]+)/g;

const HOOKYY_REPORT_VERSION = 1;

class HookyyPlaywrightReporter {
  private rootDir = process.cwd();
  private version?: string;
  private multiProject = false;
  private readonly scenarios = new Map<string, ScenarioData>();
  /** Hooks per attempt, finalized with the attempt's status in onTestEnd. */
  private readonly attempts = new Map<TestResult, HookExecution[]>();
  private readonly outputFile: string;

  constructor(options: HookyyReporterOptions = {}) {
    this.outputFile = options.outputFile ?? process.env.HOOKYY_OUTPUT_FILE ?? 'hookyy-playwright.json';
  }

  printsToStdio(): boolean {
    return false;
  }

  // Older Playwright versions (< 1.20) call every reporter method unconditionally.
  onTestBegin(): void {}
  onStepBegin(): void {}
  onStdOut(): void {}
  onStdErr(): void {}
  onError(): void {}

  onBegin(config: FullConfig): void {
    // config.rootDir is the test directory; resolve paths from the project (config file) directory like built-in reporters.
    this.rootDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.version = config.version;
    this.multiProject = (config.projects?.length ?? 0) > 1;
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category !== 'hook' || !step.location || GROUP_TITLES.has(step.title)) return;
    const scenario = this.scenario(test);
    const location = `${path.relative(this.rootDir, step.location.file).replace(/\\/g, '/')}:${step.location.line}`;
    const exec: HookExecution = {
      hookName: `${step.title} (${location})`,
      type: hookType(step),
      location,
      scenarioName: scenario.name,
      scenarioTags: scenario.tags,
      duration: Math.max(0, step.duration),
      passed: !step.error,
      error: step.error ? firstLine((step.error as { message?: string }).message) : undefined,
      skipped: false,
      timestamp: result.startTime ? result.startTime.getTime() : undefined,
    };
    scenario.hooks.push(exec);
    if (!this.attempts.has(result)) this.attempts.set(result, []);
    this.attempts.get(result)!.push(exec);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const scenario = this.scenario(test);
    scenario.skipped = result.status === 'skipped';
    scenario.passed = result.status === 'passed';
    scenario.duration = (scenario.duration ?? 0) + result.duration;
    for (const exec of this.attempts.get(result) ?? []) exec.scenarioSkipped = scenario.skipped;
    this.attempts.delete(result);
  }

  onEnd(): void {
    const report = {
      hookyyReport: HOOKYY_REPORT_VERSION,
      framework: 'playwright',
      generator: `hookyy/playwright-reporter${this.version ? ` (playwright ${this.version})` : ''}`,
      scenarios: Array.from(this.scenarios.values()),
    };
    const file = path.resolve(this.rootDir, this.outputFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
  }

  private scenario(test: TestCase): ScenarioData {
    let s = this.scenarios.get(test.id);
    if (!s) {
      // titlePath: ['', project, file, ...describe blocks, title]
      const [, project, file, ...rest] = titlePathOf(test);
      const base = [file && file.split(path.sep).join('/'), ...rest].filter(Boolean).join(' › ');
      const name = this.multiProject && project ? `${base} [${project}]` : base;
      const titleTags = rest.flatMap((t) => Array.from(t.matchAll(TAG_IN_TITLE), (m) => m[2]));
      const tags = Array.from(new Set([...(test.tags ?? []), ...titleTags]));
      s = { name, id: test.id, tags, passed: false, skipped: false, hooks: [] };
      this.scenarios.set(test.id, s);
    }
    return s;
  }
}

/** ['', project, file, ...describe blocks, title]; Playwright < 1.19 has no titlePath(). */
function titlePathOf(test: TestCase): string[] {
  if (typeof test.titlePath === 'function') return test.titlePath();
  const titles: string[] = [];
  for (let s = test.parent; s; s = s.parent) if (s.title) titles.unshift(s.title);
  return ['', ...titles, test.title];
}

function firstLine(text?: string): string | undefined {
  if (!text) return undefined;
  // Strip ANSI colour codes (Playwright adds them to error messages).
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim());
  return line ? line.trim().slice(0, 300) : undefined;
}

function hookType(step: TestStep): HookType {
  if (/\bbeforeAll\b/.test(step.title)) return 'beforeAll';
  if (/\bafterAll\b/.test(step.title)) return 'afterAll';
  if (/\bafterEach\b/.test(step.title)) return 'after';
  if (/\bbeforeEach\b/.test(step.title)) return 'before';
  for (let p = step.parent; p; p = p.parent) {
    if (p.title === 'After Hooks' || p.title === 'Worker Cleanup') return 'after';
    if (p.title === 'Before Hooks') return 'before';
  }
  return 'before';
}

export default HookyyPlaywrightReporter;

import type { HookExecution, HookType, ParsedTestData, ScenarioData } from '../types';
import { firstLine, HookyyError, nsToMs, readHookTagsFromSource, unique } from '../utils';
import { BaseParser, ParserOptions } from './BaseParser';

interface CucumberResult {
  status?: string;
  duration?: number;
  error_message?: string;
}

interface CucumberStep {
  keyword?: string;
  name?: string;
  hidden?: boolean;
  match?: { location?: string };
  result?: CucumberResult;
}

interface CucumberElement {
  id?: string;
  name?: string;
  keyword?: string;
  type?: string;
  line?: number;
  tags?: Array<{ name: string }>;
  before?: CucumberStep[];
  after?: CucumberStep[];
  steps?: CucumberStep[];
}

interface CucumberFeature {
  uri?: string;
  name?: string;
  tags?: Array<{ name: string }>;
  elements?: CucumberElement[];
}

const NOT_RUN = new Set(['skipped', 'pending', 'undefined']);

/**
 * Parses the standard Cucumber JSON report (cucumber-js, cucumber-jvm,
 * cucumber-ruby, and the Cypress cucumber preprocessor).
 *
 * cucumber-js emits hooks inside `steps` with `hidden: true` and a
 * `Before`/`After` keyword; Ruby/JVM emit separate `before`/`after` arrays.
 * Both layouts are supported.
 */
export class CucumberParser extends BaseParser {
  readonly name = 'cucumber';
  readonly aliases = ['cucumber-js', 'cypress', 'cypress-cucumber'];

  detect(data: unknown): boolean {
    if (!Array.isArray(data)) return false;
    if (data.length === 0) return true;
    return data.some((f) => f && typeof f === 'object' && Array.isArray((f as CucumberFeature).elements));
  }

  parse(data: unknown, options: ParserOptions = {}): ParsedTestData {
    if (!Array.isArray(data)) {
      throw new HookyyError('Cucumber report must be a JSON array of features.', 'Generate it with `--format json:<file>`.');
    }
    const rootDir = options.rootDir ?? process.cwd();
    const scenarios: ScenarioData[] = [];

    for (const feature of data as CucumberFeature[]) {
      if (!feature || !Array.isArray(feature.elements)) continue;
      const featureTags = (feature.tags ?? []).map((t) => t.name);

      for (const el of feature.elements) {
        // Backgrounds are merged into scenarios by modern formatters; skip standalone ones.
        if (el.type === 'background' || el.keyword === 'Background') continue;
        scenarios.push(this.parseElement(feature, el, featureTags, rootDir));
      }
    }

    const warnings: string[] = [];
    const allHooks = scenarios.flatMap((s) => s.hooks);
    if (allHooks.some((h) => !h.location)) {
      warnings.push(
        'This Cucumber JSON report has no hook locations (cucumber-js 7+ omits them), so hooks are identified by position ' +
          '("Before #1"). That is ambiguous when tagged hooks only apply to some scenarios, and tag expressions cannot be read. ' +
          'For exact results, also write Cucumber Messages (--format message:report.ndjson) and analyze that file.',
      );
    }

    return { framework: 'cucumber', scenarios, warnings, metadata: { features: (data as unknown[]).length } };
  }

  private parseElement(feature: CucumberFeature, el: CucumberElement, featureTags: string[], rootDir: string): ScenarioData {
    const tags = unique([...featureTags, ...(el.tags ?? []).map((t) => t.name)]);
    // Unnamed scenarios are valid Gherkin: identify them by line so they stay distinct.
    const title = el.name?.trim() || `(unnamed scenario${el.line ? `, line ${el.line}` : ''})`;
    const name = feature.name ? `${feature.name} › ${title}` : title;

    const hookSteps: Array<{ step: CucumberStep; type: HookType }> = [];
    const realSteps: CucumberStep[] = [];

    for (const step of el.before ?? []) hookSteps.push({ step, type: 'before' });
    for (const step of el.steps ?? []) {
      const kw = (step.keyword ?? '').trim();
      if (kw === 'Before' || kw === 'After') {
        hookSteps.push({ step, type: kw === 'Before' ? 'before' : 'after' });
      } else if (step.hidden) {
        // Hidden but unrecognised keyword: not a user step, ignore.
      } else {
        realSteps.push(step);
      }
    }
    for (const step of el.after ?? []) hookSteps.push({ step, type: 'after' });

    // Mirror Cucumber's result precedence: failed > … > pending > skipped > passed.
    const statuses = realSteps.map((s) => s.result?.status ?? 'undefined');
    // Undefined/ambiguous steps outrank skipped: such a scenario is broken, not skipped.
    const failed =
      statuses.some((s) => s === 'failed' || s === 'undefined' || s === 'ambiguous') ||
      hookSteps.some(({ step }) => step.result?.status === 'failed');
    const skipped = !failed && statuses.some((s) => s === 'skipped' || s === 'pending');
    const passed = !failed && !skipped && statuses.every((s) => s === 'passed');

    const ordinal = { before: 0, after: 0 } as Record<string, number>;
    const hooks: HookExecution[] = hookSteps.map(({ step, type }) => {
      const location = step.match?.location?.replace(/\\/g, '/');
      const status = step.result?.status ?? 'undefined';
      const duration = nsToMs(step.result?.duration);
      ordinal[type] += 1;
      // cucumber-js >= 7 omits hook locations: fall back to the hook's position within the scenario.
      const positional = `${type === 'before' ? 'Before' : 'After'} #${ordinal[type]}`;
      return {
        hookName: step.name?.trim() || location || positional,
        type,
        location,
        hookTags: readHookTagsFromSource(location, rootDir),
        scenarioName: name,
        scenarioTags: tags,
        duration,
        passed: status === 'passed',
        error: status === 'failed' ? firstLine(step.result?.error_message) : undefined,
        // A hook that returned 'skipped' still ran (and took time); one skipped after a failure did not.
        skipped: NOT_RUN.has(status) && duration === 0,
        scenarioSkipped: skipped,
      };
    });

    const duration = [...hookSteps.map((h) => h.step), ...realSteps].reduce((sum, s) => sum + nsToMs(s.result?.duration), 0);

    return { name, id: el.id, tags, passed, skipped, hooks, duration };
  }
}

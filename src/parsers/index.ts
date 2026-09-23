import { HookyyError } from '../utils';
import { BaseParser } from './BaseParser';
import { CucumberMessagesParser } from './CucumberMessagesParser';
import { CucumberParser } from './CucumberParser';
import { HookyyReportParser } from './HookyyReportParser';
import { PlaywrightParser } from './PlaywrightParser';

export { BaseParser, CucumberParser, CucumberMessagesParser, HookyyReportParser, PlaywrightParser };
export type { ParserOptions } from './BaseParser';

const registry: BaseParser[] = [new HookyyReportParser(), new CucumberMessagesParser(), new CucumberParser(), new PlaywrightParser()];

/** Add a custom parser. Registered parsers take priority during auto-detection. */
export function registerParser(parser: BaseParser): void {
  const idx = registry.findIndex((p) => p.name === parser.name);
  if (idx >= 0) registry.splice(idx, 1);
  registry.unshift(parser);
}

export function getParsers(): readonly BaseParser[] {
  return registry;
}

export function getParser(name: string): BaseParser {
  const parser = registry.find((p) => p.matches(name));
  if (!parser) {
    const known = registry.map((p) => [p.name, ...p.aliases].join('/')).join(', ');
    throw new HookyyError(`Unknown parser "${name}".`, `Available parsers: ${known}`);
  }
  return parser;
}

export function detectParser(data: unknown): BaseParser {
  const parser = registry.find((p) => p.detect(data));
  if (!parser) {
    const hint = Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] && 'suites' in (data[0] as object)
      ? 'This looks like a mocha/Cypress JSON report, which has no hook data. Use the Cypress cucumber preprocessor JSON output.'
      : 'Supported: Cucumber JSON, Cucumber Messages (.ndjson), Playwright JSON, and hookyy/playwright-reporter output. Pass --parser explicitly, or check the report was generated with a JSON reporter.';
    throw new HookyyError('Could not detect the report format.', hint);
  }
  return parser;
}

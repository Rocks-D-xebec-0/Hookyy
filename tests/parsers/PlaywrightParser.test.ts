import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { PLAYWRIGHT_JSON_WARNING } from '../../src/parsers/PlaywrightParser';
import { PlaywrightParser } from '../../src/parsers';
import { fixture } from '../helpers';

// Real report: angelo-loria/playwright-boilerplate, Playwright 1.46, `--reporter=json`.
const report = () => JSON.parse(fs.readFileSync(fixture('real/playwright-json-angelo.json'), 'utf8'));

describe('PlaywrightParser (built-in JSON reporter)', () => {
  const parser = new PlaywrightParser();

  it('detects Playwright JSON reports', () => {
    expect(parser.detect(report())).toBe(true);
    expect(parser.detect([])).toBe(false);
    expect(parser.detect({ suites: [] })).toBe(false);
  });

  it('reads scenarios with describe paths, tags and skip status', () => {
    const parsed = parser.parse(report());
    expect(parsed.framework).toBe('playwright 1.46.0 (JSON reporter)');
    expect(parsed.scenarios.length).toBeGreaterThan(0);
    expect(parsed.scenarios.some((s) => s.skipped)).toBe(true);
    expect(parsed.scenarios.every((s) => s.hooks.length === 0)).toBe(true);
  });

  it('warns that the JSON reporter never contains hooks, pointing at the Hookyy reporter', () => {
    const { result } = analyze({ reportPath: fixture('real/playwright-json-angelo.json'), config: {} });
    expect(result.summary.totalHooks).toBe(0);
    expect(result.warnings).toEqual([PLAYWRIGHT_JSON_WARNING]);
    expect(PLAYWRIGHT_JSON_WARNING).toContain('hookyy/playwright-reporter');
  });
});

describe('reporting when nothing could be audited', () => {
  it('does not claim "no issues" when zero hooks were audited', async () => {
    const { MarkdownReporter, CLIReporter } = await import('../../src/reporters');
    const { result } = analyze({ reportPath: fixture('real/playwright-json-angelo.json'), config: {} });
    expect(new MarkdownReporter().render(result)).toContain('No hooks could be audited');
    const cli = new CLIReporter().render(result, { color: false });
    expect(cli).toContain('No hooks could be audited');
    expect(cli).not.toContain('No hook issues found');
  });
});

import { describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { CLIReporter, createReporter, HTMLReporter, JSONReporter, MarkdownReporter } from '../../src/reporters';
import { data, scenario } from '../helpers';
import { HookAnalyzer } from '../../src/analyzer/HookAnalyzer';
import { defaultConfig } from '../../src/config/DefaultConfig';
import { CUCUMBER_ROOT, fixture } from '../helpers';

const result = () => analyze({ reportPath: fixture('cucumber-report.json'), config: { rootDir: CUCUMBER_ROOT } }).result;
const clean = () => new HookAnalyzer(defaultConfig()).analyze(data([scenario('a', [{ hookName: 'ok' }])]));

describe('JSONReporter', () => {
  it('produces valid JSON with serialized hooks', () => {
    const out = JSON.parse(new JSONReporter().render(result()));
    expect(out.tool).toBe('hookyy');
    expect(out.summary.issuesFound).toBe(4);
    expect(out.issues).toHaveLength(4);
    expect(Array.isArray(out.hooks)).toBe(true);
    const db = out.hooks.find((h: any) => h.name === 'features/support/hooks.js:5');
    expect(db).toMatchObject({ executions: 2, hookTags: '@db', maxDuration: 1500, issues: ['TAG_MISMATCH', 'SLOW'] });
    expect(db.scenariosAffected).toHaveLength(2);
  });
});

describe('MarkdownReporter', () => {
  it('renders summary, issue and hook tables', () => {
    const md = new MarkdownReporter().render(result(), { verbose: true });
    expect(md).toContain('# 🪝 Hookyy report');
    expect(md).toContain('| Severity | Code | Hook | Message |');
    expect(md).toContain('`TAG_MISMATCH`');
    expect(md).toContain('Checkout › Guest checkout · tags: @checkout @smoke');
    expect(md).toContain('## Hooks');
  });

  it('shows a success message when there are no issues', () => {
    expect(new MarkdownReporter().render(clean())).toContain('✅ **No hook issues found.**');
  });

  it('escapes pipes in cells', () => {
    const r = new HookAnalyzer(defaultConfig()).analyze(data([scenario('a', [{ hookName: 'a|b', duration: 5000 }])]));
    expect(new MarkdownReporter().render(r)).toContain('a\\|b');
  });
});

describe('CLIReporter', () => {
  it('renders a table of issues without colors', () => {
    const out = new CLIReporter().render(result(), { color: false });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toContain('TAG_MISMATCH');
    expect(out).toContain('4 issue(s): 1 error, 3 warning, 0 info');
    expect(out).toContain('--verbose');
  });

  it('includes recommendations and the hooks table in verbose mode', () => {
    const out = new CLIReporter().render(result(), { color: false, verbose: true });
    expect(out).toContain('Recommendations');
    expect(out).toContain('Hooks');
    expect(out).not.toContain('Run with --verbose');
  });

  it('prints a success line for clean results', () => {
    expect(new CLIReporter().render(clean(), { color: false })).toContain('No hook issues found');
  });
});

describe('HTMLReporter', () => {
  it('embeds the data into the template', () => {
    const html = new HTMLReporter().render(result());
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toContain('/*__HOOKYY_DATA__*/null');
    const json = /const DATA = (.*);\n/.exec(html)![1];
    expect(JSON.parse(json).summary.issuesFound).toBe(4);
  });

  it('cannot be broken out of the script tag by hook names', () => {
    const r = new HookAnalyzer(defaultConfig()).analyze(data([scenario('a', [{ hookName: '</script><img src=x onerror=alert(1)>', duration: 5000 }])]));
    const html = new HTMLReporter().render(r);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('\\u003c/script>');
  });
});

describe('createReporter', () => {
  it('creates reporters by type and rejects unknown ones', () => {
    expect(createReporter('md')).toBeInstanceOf(MarkdownReporter);
    expect(createReporter('html')).toBeInstanceOf(HTMLReporter);
    expect(() => createReporter('pdf')).toThrow(/Unknown format/);
  });
});

describe('reports without hooks', () => {
  it('says there was nothing to audit instead of claiming a clean result', () => {
    const r = new HookAnalyzer(defaultConfig()).analyze(data([scenario('a', [])]));
    expect(new CLIReporter().render(r, { color: false })).toContain('No hooks found in this report');
    expect(new MarkdownReporter().render(r)).toContain('No hooks found in this report');
  });
});

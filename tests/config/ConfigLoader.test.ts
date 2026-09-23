import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findConfigFile, loadConfig } from '../../src/config/ConfigLoader';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookyy-config-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const write = (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);

describe('ConfigLoader', () => {
  it('returns defaults when no config file exists', () => {
    const { config, source } = loadConfig(undefined, dir);
    expect(source).toBeUndefined();
    expect(config.rules.slow.threshold).toBe(1000);
    expect(config.reporters).toEqual([{ type: 'cli' }]);
  });

  it('auto-discovers hook-auditor.config.yml and merges with defaults', () => {
    write(
      'hook-auditor.config.yml',
      [
        'rules:',
        '  slow:',
        '    threshold: 250',
        '  orphaned:',
        '    severity: error',
        'reporters:',
        '  - type: json',
        '    output: out/hooks.json',
        '  - markdown',
        'hookTags:',
        '  "hooks.ts:10": "@db"',
      ].join('\n'),
    );
    expect(findConfigFile(dir)).toBe(path.join(dir, 'hook-auditor.config.yml'));
    const { config } = loadConfig(undefined, dir);
    expect(config.rules.slow).toEqual({ enabled: true, threshold: 250, metric: 'median', severity: 'warning' });
    expect(config.rules.orphaned.severity).toBe('error');
    expect(config.rules.unused.enabled).toBe(true);
    expect(config.reporters).toEqual([{ type: 'json', output: 'out/hooks.json' }, { type: 'markdown' }]);
    expect(config.hookTags).toEqual({ 'hooks.ts:10': '@db' });
    expect(config.rootDir).toBe(dir);
  });

  it('loads an explicit path', () => {
    write('custom.yml', 'rules:\n  unused:\n    enabled: false\n');
    expect(loadConfig('custom.yml', dir).config.rules.unused.enabled).toBe(false);
  });

  it('accepts an empty file', () => {
    write('hookyy.config.yml', '');
    expect(loadConfig(undefined, dir).config.rules.slow.threshold).toBe(1000);
  });

  it.each([
    ['rules:\n  bogus: {}\n', /unknown rule "bogus"/],
    ['rules:\n  slow:\n    severity: fatal\n', /severity must be/],
    ['rules:\n  slow:\n    threshold: -5\n', /threshold must be/],
    ['rules:\n  slow:\n    metric: p99\n', /metric must be median, avg or max/],
    ['reporters:\n  - type: pdf\n', /reporters\[0\]\.type/],
    ['ignore: foo\n', /"ignore" must be a list/],
    ['- just a list\n', /mapping at the top level/],
    ['rules: [unclosed\n', /Invalid YAML/],
  ])('rejects invalid config %#', (content, error) => {
    write('bad.yml', content);
    expect(() => loadConfig('bad.yml', dir)).toThrow(error);
  });

  it('errors when an explicit config path is missing', () => {
    expect(() => loadConfig('missing.yml', dir)).toThrow(/Config file not found/);
  });
});

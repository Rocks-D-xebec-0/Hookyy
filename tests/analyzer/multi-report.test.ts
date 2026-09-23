import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { EXIT, runAnalyze } from '../../src/cli';
import { expandReportPaths } from '../../src/utils';
import { fixture } from '../helpers';

// Field test: WebdriverIO writes one Messages file per worker (hookyy-messages.0-0.ndjson, …),
// Playwright shards and the Cypress preprocessor write one report per shard/spec.

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookyy-multi-'));
  fs.copyFileSync(fixture('real/cucumberjs8-rajatt95.ndjson'), path.join(dir, 'hookyy-messages.0-0.ndjson'));
  fs.copyFileSync(fixture('real/cucumberjs12-tallyb.ndjson'), path.join(dir, 'hookyy-messages.0-1.ndjson'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a report');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('expandReportPaths', () => {
  it('expands basename wildcards itself (Windows shells do not)', () => {
    const files = expandReportPaths(['hookyy-messages.*.ndjson'], dir).map((f) => path.basename(f));
    expect(files).toEqual(['hookyy-messages.0-0.ndjson', 'hookyy-messages.0-1.ndjson']);
  });

  it('expands a directory to its .json/.ndjson files and de-duplicates', () => {
    const files = expandReportPaths([dir, path.join(dir, 'hookyy-messages.0-0.ndjson')], dir).map((f) => path.basename(f));
    expect(files).toEqual(['hookyy-messages.0-0.ndjson', 'hookyy-messages.0-1.ndjson']);
  });

  it('fails clearly when a wildcard matches nothing', () => {
    expect(() => expandReportPaths(['*.nope'], dir)).toThrow(/No report matches/);
  });
});

describe('analyzing several reports as one run', () => {
  it('merges scenarios, hooks and declarations across files', () => {
    const { result, parser } = analyze({ reportPaths: [path.join(dir, '*.ndjson')], config: {} });
    expect(parser).toBe('cucumber-messages');
    expect(result.summary.totalScenarios).toBe(4 + 3);
    expect(result.framework).toBe('cucumber (cucumber-js 8.1.2), cucumber (cucumber-js 12.2.0)');
    // Declared-but-unused hooks from the tallyb file survive the merge.
    expect(result.issues.filter((i) => i.code === 'UNUSED').map((i) => i.hookName)).toEqual([
      'src/support/common-hooks.ts:47',
      'src/support/common-hooks.ts:51',
    ]);
  });

  it('works from the CLI with several positional reports', () => {
    const out = { data: '', write(c: string) { this.data += c; return true; } };
    const err = { data: '', write(c: string) { this.data += c; return true; } };
    const code = runAnalyze(
      { reports: [path.join(dir, 'hookyy-messages.0-0.ndjson'), path.join(dir, 'hookyy-messages.0-1.ndjson')], format: 'json', color: false },
      { out, err } as any,
    );
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(out.data).summary.totalScenarios).toBe(7);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, runAnalyze } from '../../src/cli';
import { fixture } from '../helpers';

class Sink {
  data = '';
  write(chunk: string) {
    this.data += chunk;
    return true;
  }
}

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookyy-cli-'));
  cwd = process.cwd();
  process.chdir(dir); // isolate from any config file in the repo
});
afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(args: Parameters<typeof runAnalyze>[0]) {
  const out = new Sink();
  const err = new Sink();
  const code = runAnalyze({ color: false, ...args }, { out, err } as any);
  return { code, out: out.data, err: err.data };
}

describe('hookyy analyze', () => {
  it('prints the CLI table and exits 0 by default', () => {
    const r = run({ reportPath: fixture('playwright-hookyy.json') });
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toContain('ORPHANED');
    expect(r.out).toContain('SLOW');
  });

  it('exits 1 when --fail-on threshold is met', () => {
    expect(run({ reportPath: fixture('playwright-hookyy.json'), failOn: ['warning'] }).code).toBe(EXIT.ISSUES);
    expect(run({ reportPath: fixture('playwright-hookyy.json'), failOn: ['error'] }).code).toBe(EXIT.OK);
  });

  it('prints JSON to stdout when no output file is given', () => {
    const r = run({ reportPath: fixture('playwright-hookyy.json'), format: 'json' });
    expect(JSON.parse(r.out).summary.issuesFound).toBe(2);
  });

  it('writes non-CLI formats to --output', () => {
    const r = run({ reportPath: fixture('playwright-hookyy.json'), format: 'html', output: 'reports/hooks.html' });
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toBe('');
    expect(r.err).toContain('html report written to');
    expect(fs.readFileSync(path.join(dir, 'reports/hooks.html'), 'utf8')).toContain('Hookyy Report');
  });

  it('uses reporters from the config file when --format is not given', () => {
    fs.writeFileSync(
      path.join(dir, 'hook-auditor.config.yml'),
      'rules:\n  slow:\n    threshold: 5000\nreporters:\n  - type: markdown\n    output: hooks.md\n',
    );
    const r = run({ reportPath: fixture('playwright-hookyy.json') });
    const md = fs.readFileSync(path.join(dir, 'hooks.md'), 'utf8');
    expect(md).toContain('ORPHANED');
    expect(md).not.toContain('`SLOW`');
    expect(r.code).toBe(EXIT.OK);
  });

  it('exits 2 with a clear message for a missing report', () => {
    const r = run({ reportPath: 'nope.json' });
    expect(r.code).toBe(EXIT.ERROR);
    expect(r.err).toContain('Report not found');
  });

  it('exits 2 for invalid JSON and unknown parsers', () => {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
    expect(run({ reportPath: 'bad.json' }).err).toContain('not valid JSON');
    const r = run({ reportPath: fixture('playwright-hookyy.json'), parser: 'jest' });
    expect(r.code).toBe(EXIT.ERROR);
    expect(r.err).toContain('Unknown parser');
  });

  it('honours an explicit parser', () => {
    const r = run({ reportPath: fixture('cucumber-report.json'), parser: 'cypress', format: 'json' });
    expect(JSON.parse(r.out).framework).toBe('cucumber');
  });
});

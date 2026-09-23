import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { analyze, report, shouldFail } from '../index';
import { VERSION } from '../reporters/serialize';
import type { ReporterConfig, ReporterType, Severity } from '../types';
import { expandReportPaths, HookyyError } from '../utils';
import { detectProject, writeInit } from './init';
import { cleanOutDir, planRun, RunPlan } from './run';

export const EXIT = { OK: 0, ISSUES: 1, ERROR: 2 } as const;

interface AnalyzeArgs {
  /** One or more reports (files, directories or basename wildcards). */
  reports?: string[];
  /** Single report (programmatic callers / tests). */
  reportPath?: string;
  format?: string;
  output?: string;
  failOn?: string[];
  config?: string;
  watch?: boolean;
  verbose?: boolean;
  parser?: string;
  color?: boolean;
}

/** Run one analysis. Returns the exit code; never throws. */
export function runAnalyze(args: AnalyzeArgs, io = { out: process.stdout, err: process.stderr }): number {
  try {
    const { result, config, parser, configSource } = analyze({
      reportPaths: reportArgs(args),
      parser: args.parser,
      configPath: args.config,
    });

    const reporters: ReporterConfig[] = args.format
      ? [{ type: normalizeFormat(args.format), output: args.output, verbose: args.verbose }]
      : args.output
        ? config.reporters.map((r) => ({ ...r, output: r.output ?? args.output }))
        : config.reporters;

    if (args.verbose) {
      io.err.write(pc.dim(`hookyy: parser=${parser}${configSource ? ` config=${configSource}` : ''}\n`));
    }

    for (const out of report(result, reporters, { verbose: args.verbose, color: args.color })) {
      if (out.file) io.err.write(`${pc.green('✔')} ${out.type} report written to ${out.file}\n`);
      else io.out.write(out.content.endsWith('\n') ? out.content : out.content + '\n');
    }

    const failOn = (args.failOn ?? []) as Severity[];
    if (shouldFail(result, failOn)) {
      io.err.write(pc.red(`✖ Failing: found issues at severity ${failOn.join('/')} or above.\n`));
      return EXIT.ISSUES;
    }
    return EXIT.OK;
  } catch (err) {
    printError(err, io.err, args.verbose);
    return EXIT.ERROR;
  }
}

function reportArgs(args: AnalyzeArgs): string[] {
  return args.reports?.length ? args.reports.map(String) : [args.reportPath ?? ''];
}

function normalizeFormat(format: string): ReporterType {
  return (format === 'md' ? 'markdown' : format) as ReporterType;
}

function printError(err: unknown, stream: NodeJS.WritableStream, verbose?: boolean): void {
  if (err instanceof HookyyError) {
    stream.write(`${pc.red('✖ Error:')} ${err.message}\n`);
    if (err.hint) stream.write(`  ${pc.dim(err.hint)}\n`);
  } else {
    stream.write(`${pc.red('✖ Unexpected error:')} ${(err as Error)?.message ?? String(err)}\n`);
    if (verbose && err instanceof Error && err.stack) stream.write(pc.dim(err.stack) + '\n');
    else stream.write(pc.dim('  Re-run with --verbose for a stack trace.\n'));
  }
}

function watch(args: AnalyzeArgs): void {
  let timer: NodeJS.Timeout | undefined;
  const run = () => {
    process.stdout.write('\x1Bc');
    runAnalyze(args);
    process.stderr.write(pc.dim(`\nWatching ${reportArgs(args).join(', ')} for changes (Ctrl+C to exit)\n`));
  };

  // Watch each report's directory: reporters often delete and recreate files, and wildcards may match new ones.
  const dirs = new Set(
    reportArgs(args).map((p) => {
      const abs = path.resolve(p);
      return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    }),
  );
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      process.stderr.write(`${pc.red('✖ Error:')} directory does not exist: ${dir}\n`);
      process.exit(EXIT.ERROR);
    }
  }
  run();
  for (const dir of dirs) {
    fs.watch(dir, (_event, name) => {
      if (!name || !/\.(nd)?json$/i.test(name.toString())) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
  }
}

interface RunArgs extends AnalyzeArgs {
  /** The test command (everything after `--`). */
  command: string[];
  outDir?: string;
}

/** Hookyy's own Playwright reporter next to the CLI (dist/), so `run` works without a local install. */
function ownReporter(): string | undefined {
  const candidate = path.join(__dirname, 'playwright-reporter.js');
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * `hookyy run -- <test command>`: add the right reporter flag for the framework, run the tests,
 * then analyze. Exits with the test command's code when the tests failed, otherwise with Hookyy's.
 */
export function runTests(args: RunArgs, io = { out: process.stdout, err: process.stderr }): number {
  const cwd = process.cwd();
  let plan: RunPlan;
  try {
    plan = planRun(args.command, cwd, args.outDir ?? '.hookyy', ownReporter());
  } catch (err) {
    printError(err, io.err, args.verbose);
    return EXIT.ERROR;
  }
  io.err.write(pc.dim(`hookyy: ${plan.framework} detected, running: ${plan.command}\n`));
  for (const note of plan.notes) io.err.write(pc.yellow(`ℹ ${note}\n`));

  cleanOutDir(cwd, plan.outDir);
  fs.mkdirSync(path.resolve(cwd, plan.outDir), { recursive: true });
  const child = spawnSync(plan.command, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...plan.env } });
  const testExit = child.status ?? 1;
  io.err.write(pc.dim(`\nhookyy: tests finished (exit code ${testExit}), analyzing hooks…\n`));

  const produced = plan.reports.filter((r) => {
    try {
      return expandReportPaths([r], cwd).some((f) => fs.existsSync(f));
    } catch {
      return false;
    }
  });
  if (!produced.length) {
    io.err.write(`${pc.red('✖ Error:')} the test run didn't write a report to ${plan.reports.join(', ')}\n`);
    io.err.write(pc.dim('  Did the run start at all? Check the output above. For npm scripts, the runner must be the last command.\n'));
    return testExit !== 0 ? testExit : EXIT.ERROR;
  }
  const code = runAnalyze({ ...args, reports: produced }, io);
  return testExit !== 0 ? testExit : code;
}

function runInit(args: { write?: boolean }, io = { out: process.stdout, err: process.stderr }): number {
  const cwd = process.cwd();
  const found = detectProject(cwd);
  if (!found.length) {
    io.err.write(`${pc.yellow('No supported test framework found in')} ${cwd}\n`);
    io.err.write(pc.dim('  Hookyy supports Playwright Test, playwright-bdd, cucumber-js, Cypress + @badeball, WebdriverIO + Cucumber and Cucumber-JVM (Maven).\n'));
    return EXIT.ERROR;
  }
  io.out.write(`${pc.bold('Detected')}\n`);
  for (const d of found) io.out.write(`  • ${d.framework}  ${pc.dim(`(${d.why})`)}\n`);
  const main = found[0];
  io.out.write(`\n${pc.bold('Audit your hooks with')}\n  npx hookyy run -- ${main.command}\n`);
  if (args.write) {
    const written = writeInit(cwd, main);
    io.out.write(written.length ? `\n${pc.green('✔')} Wrote ${written.join(', ')}\n  Next: npm run test:hooks\n` : `\n${pc.dim('Nothing to write: test:hooks and hook-auditor.config.yml already exist.')}\n`);
  } else {
    io.out.write(pc.dim('\nRun `hookyy init --write` to add a "test:hooks" script and a starter hook-auditor.config.yml.\n'));
  }
  return EXIT.OK;
}

function outputOptions<T>(y: import('yargs').Argv<T>) {
  return y
    .option('format', { alias: 'f', type: 'string', choices: ['cli', 'html', 'json', 'markdown', 'md'], describe: 'Output format (default: cli, or reporters from config)' })
    .option('output', { alias: 'o', type: 'string', describe: 'Write the report to this file instead of stdout' })
    .option('fail-on', { type: 'array', string: true, choices: ['error', 'warning', 'info'], describe: 'Exit 1 when issues at or above this severity exist' })
    .option('config', { alias: 'c', type: 'string', describe: 'Path to hook-auditor.config.yml (auto-discovered in cwd)' })
    .option('verbose', { alias: 'v', type: 'boolean', describe: 'Show recommendations, evidence and per-hook stats' })
    .option('color', { type: 'boolean', describe: 'Force colors on/off (use --no-color to disable)' });
}

export function buildCli(argv: string[] = hideBin(process.argv)) {
  return yargs(argv)
    .scriptName('hookyy')
    .detectLocale(false)
    .parserConfiguration({ 'populate--': true })
    .usage('$0 <command> [options]')
    .command<AnalyzeArgs>(
      ['analyze <reports..>', '$0 <reports..>'],
      'Analyze hooks in one or more test reports (Cucumber Messages/JSON, hookyy/playwright-reporter)',
      (y) =>
        outputOptions(
          y.positional('reports', { type: 'string', array: true, describe: 'Report file(s), directories, or wildcards like "reports/*.ndjson" (merged into one run)', demandOption: true }),
        )
          .option('watch', { alias: 'w', type: 'boolean', describe: 'Re-analyze whenever the report changes' })
          .option('parser', { type: 'string', describe: 'Force a parser: cucumber-messages, cucumber, hookyy, playwright, cypress (auto-detected per file)' })
          .example('$0 analyze reports/hookyy.ndjson', 'Print a table of hook issues')
          .example('$0 analyze "reports/*.ndjson"', 'Merge one report per worker/shard')
          .example('$0 analyze hookyy-playwright.json -f html -o hooks.html', 'Write an HTML dashboard')
          .example('$0 analyze report.ndjson --fail-on error', 'Fail CI on error-level issues'),
      (args) => {
        if (args.watch) return watch(args);
        process.exitCode = runAnalyze(args);
      },
    )
    .command<RunArgs>(
      'run',
      'Run your tests with the right reporter added, then analyze their hooks (hookyy run -- <test command>)',
      (y) =>
        outputOptions(y)
          .option('out-dir', { type: 'string', default: '.hookyy', describe: 'Where the reporter writes its output' })
          .example('$0 run -- npx playwright test', 'Playwright Test')
          .example('$0 run -- npm test', 'Any supported runner behind an npm script')
          .example('$0 run --fail-on warning -- npx cucumber-js', 'Fail when hook issues are found'),
      (args) => {
        const command = ((args as unknown as Record<string, unknown>)['--'] as string[] | undefined) ?? [];
        process.exitCode = runTests({ ...args, command: command.map(String) });
      },
    )
    .command<{ write?: boolean }>(
      'init',
      'Detect your test framework and show (or add) the command that audits its hooks',
      (y) =>
        y
          .option('write', { type: 'boolean', describe: 'Add a "test:hooks" script and a starter hook-auditor.config.yml' })
          .option('color', { type: 'boolean', describe: 'Force colors on/off (use --no-color to disable)' }),
      (args) => {
        process.exitCode = runInit(args);
      },
    )
    .demandCommand(1, 'Please provide a command, e.g. `hookyy run -- npm test` or `hookyy analyze <report>`')
    .strict()
    .alias('h', 'help')
    .version(VERSION)
    .wrap(Math.min(110, process.stdout.columns || 110))
    .fail((msg, err, y) => {
      if (err) throw err;
      y.showHelp();
      process.stderr.write(`\n${pc.red(msg)}\n`);
      process.exit(EXIT.ERROR);
    });
}

if (require.main === module) {
  buildCli().parse();
}

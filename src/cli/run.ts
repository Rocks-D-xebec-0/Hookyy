import * as fs from 'fs';
import * as path from 'path';
import { HookyyError } from '../utils';

export type RunFramework = 'playwright' | 'cucumber-js' | 'cypress' | 'webdriverio' | 'maven';

export interface RunPlan {
  framework: RunFramework;
  /** The command to execute, with Hookyy's reporter flag added. */
  command: string;
  env: Record<string, string>;
  /** Report paths/wildcards to analyze afterwards (relative to cwd). */
  reports: string[];
  /** Directory Hookyy writes its reports to (cleaned before the run). */
  outDir: string;
  notes: string[];
}

const RUNNERS: Array<{ framework: RunFramework; test: RegExp }> = [
  { framework: 'playwright', test: /\bplaywright(?:\.cmd)?\s+test\b/ },
  { framework: 'cucumber-js', test: /\bcucumber-js\b|@cucumber[\\/]cucumber[\\/]bin[\\/]cucumber/ },
  { framework: 'cypress', test: /\bcypress(?:\.cmd)?\s+run\b/ },
  { framework: 'webdriverio', test: /\bwdio(?:\.cmd)?\b/ },
  { framework: 'maven', test: /(?:^|[\s/\\])mvnw?(?:\.cmd)?(?:\s|$)/ },
];

export function detectRunner(text: string): RunFramework | undefined {
  return RUNNERS.find((r) => r.test.test(text))?.framework;
}

/**
 * Work out how to run `command` so it also writes a report Hookyy can read.
 *
 * `npm test`, `npm run x`, `yarn x` and `pnpm x` are resolved through package.json: the flag is passed
 * to the script (after `--` for npm), which works when the runner is the script's last command.
 */
export function planRun(command: string[], cwd: string, outDir = '.hookyy', reporterPath?: string): RunPlan {
  if (!command.length) throw new HookyyError('No test command given.', 'Usage: hookyy run -- npx playwright test');
  const cmd = command.map(quoteArg).join(' ');
  const notes: string[] = [];

  let framework = detectRunner(cmd);
  let viaScript: { manager: 'npm' | 'yarn' | 'pnpm'; name: string; body: string } | undefined;

  if (!framework) {
    const m = /^(npm|yarn|pnpm)(?:\s+run(?:-script)?)?\s+([\w:.-]+)/.exec(cmd);
    if (m) {
      const manager = m[1] as 'npm' | 'yarn' | 'pnpm';
      const name = m[2] === 't' || m[2] === 'tst' ? 'test' : m[2];
      const body = readScript(cwd, name);
      if (body === undefined) throw new HookyyError(`No "${name}" script in ${path.join(cwd, 'package.json')}.`);
      framework = detectRunner(body);
      viaScript = { manager, name, body };
      if (framework && /&&|\|\||;/.test(body) && !detectRunner(body.split(/&&|\|\||;/).pop() ?? '')) {
        notes.push(`The "${name}" script chains several commands and the test runner isn't the last one, so the reporter flag may not reach it. If no report is produced, run the runner directly: hookyy run -- <runner command>.`);
      }
    }
  }
  if (!framework) {
    throw new HookyyError(
      `Can't tell which test runner "${cmd}" uses.`,
      'Supported: playwright test, cucumber-js, cypress run, wdio, mvn/mvnw (directly or through an npm/yarn/pnpm script). ' +
        'Otherwise add a reporter yourself and use `hookyy analyze` (see the README).',
    );
  }

  const messages = `${outDir}/messages.ndjson`;
  const env: Record<string, string> = {};
  let flag: string;
  let reports: string[];

  switch (framework) {
    case 'playwright': {
      const reporter = reporterPath ?? 'hookyy/playwright-reporter';
      env.HOOKYY_OUTPUT_FILE = path.resolve(cwd, outDir, 'playwright.json');
      const existing = /--reporter[= ](\S+)/.exec(viaScript ? viaScript.body : cmd);
      // --reporter on the command line replaces the config's reporters, so keep a readable console reporter.
      flag = `--reporter=${existing ? existing[1] : 'list'},${quoteArg(reporter)}`;
      if (existing && !viaScript) {
        return plan(cmd.replace(existing[0], flag), env, [`${outDir}/playwright.json`]);
      }
      reports = [`${outDir}/playwright.json`];
      notes.push("Playwright's configured reporters are replaced for this run (a --reporter flag overrides the config).");
      break;
    }
    case 'cucumber-js':
      flag = `--format message:${messages}`;
      reports = [messages];
      break;
    case 'cypress': {
      const env0 = /--env[= ](\S+)/.exec(viaScript ? viaScript.body : cmd);
      const extra = `messagesEnabled=true,messagesOutput=${messages}`;
      if (env0 && !viaScript) return plan(cmd.replace(env0[0], `--env ${env0[1]},${extra}`), env, [messages]);
      flag = `--env ${extra}`;
      reports = [messages];
      notes.push('Requires @badeball/cypress-cucumber-preprocessor, with addCucumberPreprocessorPlugin awaited in setupNodeEvents.');
      break;
    }
    case 'webdriverio':
      flag = `--cucumberOpts.format=message:${messages}`;
      reports = [`${outDir}/messages*.ndjson`]; // WebdriverIO writes one file per worker
      break;
    case 'maven':
      flag = `-Dcucumber.plugin=message:${messages}`;
      reports = [messages];
      notes.push('If your suite uses @ConfigurationParametersResource or @ConfigurationParameter for cucumber.plugin, add the message plugin there instead: it overrides -D flags.');
      break;
  }

  const full = viaScript ? `${cmd}${viaScript.manager === 'npm' ? ' --' : ''} ${flag}` : `${cmd} ${flag}`;
  return plan(full, env, reports);

  function plan(finalCommand: string, planEnv: Record<string, string>, planReports: string[]): RunPlan {
    return { framework: framework!, command: finalCommand, env: planEnv, reports: planReports, outDir, notes };
  }
}

function readScript(cwd: string, name: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return pkg.scripts?.[name];
  } catch {
    return undefined;
  }
}

function quoteArg(arg: string): string {
  return /^[\w@%+=:,./\\*-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/** Remove Hookyy's previous reports so a failed run can't be analyzed against stale data. */
export function cleanOutDir(cwd: string, outDir: string): void {
  const abs = path.resolve(cwd, outDir);
  if (!fs.existsSync(abs)) return;
  for (const f of fs.readdirSync(abs)) {
    if (/^(messages.*\.ndjson|playwright\.json)$/.test(f)) fs.unlinkSync(path.join(abs, f));
  }
}

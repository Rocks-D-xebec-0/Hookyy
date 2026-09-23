import * as fs from 'fs';
import * as path from 'path';
import { detectRunner, RunFramework } from './run';

export interface Detection {
  framework: string;
  /** Command to wrap with `hookyy run --`. */
  command: string;
  why: string;
}

const LABELS: Record<RunFramework, string> = {
  playwright: 'Playwright Test',
  'cucumber-js': 'cucumber-js',
  cypress: 'Cypress + Cucumber',
  webdriverio: 'WebdriverIO + Cucumber',
  maven: 'Cucumber-JVM (Maven)',
};

const hasFile = (cwd: string, names: string[]) => names.some((n) => fs.existsSync(path.join(cwd, n)));
const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
const WDIO_CONFIGS = ['wdio.conf.ts', 'wdio.conf.js', 'wdio.conf.mjs', 'wdio.conf.cjs'];

/**
 * Detect test frameworks in a project and the command to wrap for each.
 *
 * Scripts come first: what `npm test` actually runs beats what's installed. Field test: a cucumber-js
 * project depends on @playwright/test only as a browser library, and a WebdriverIO project depends on
 * @cucumber/cucumber only for step definitions.
 */
export function detectProject(cwd: string): Detection[] {
  const found: Detection[] = [];
  const add = (d: Detection) => {
    if (!found.some((f) => f.framework === d.framework)) found.push(d);
  };

  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      /* unreadable package.json: fall through to other detectors */
    }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const scripts: Record<string, string> = pkg.scripts ?? {};
    const bdd = deps.includes('playwright-bdd');

    // 1. Scripts that run a supported runner ("test" first).
    const names = Object.keys(scripts).sort((a, b) => (a === 'test' ? -1 : b === 'test' ? 1 : 0));
    for (const name of names) {
      const runner = detectRunner(scripts[name]);
      if (!runner) continue;
      add({
        framework: runner === 'playwright' && bdd ? 'playwright-bdd' : LABELS[runner],
        command: name === 'test' ? 'npm test' : `npm run ${name}`,
        why: `"${name}" script: ${scripts[name]}`,
      });
    }

    // 2. Installed frameworks without a script, when they're really the runner.
    if (bdd && hasFile(cwd, PLAYWRIGHT_CONFIGS)) add({ framework: 'playwright-bdd', command: 'npx bddgen && npx playwright test', why: 'playwright-bdd + playwright.config' });
    else if (deps.includes('@playwright/test') && hasFile(cwd, PLAYWRIGHT_CONFIGS)) add({ framework: LABELS.playwright, command: 'npx playwright test', why: 'playwright.config found' });
    if ((deps.includes('@wdio/cli') || deps.includes('@wdio/cucumber-framework')) && hasFile(cwd, WDIO_CONFIGS)) {
      const conf = WDIO_CONFIGS.find((c) => fs.existsSync(path.join(cwd, c)))!;
      add({ framework: LABELS.webdriverio, command: `npx wdio run ${conf}`, why: `${conf} found` });
    }
    if (deps.includes('@badeball/cypress-cucumber-preprocessor')) add({ framework: LABELS.cypress, command: 'npx cypress run', why: '@badeball/cypress-cucumber-preprocessor in package.json' });
    if ((deps.includes('@cucumber/cucumber') || deps.includes('cucumber')) && !found.some((f) => f.framework === LABELS.webdriverio)) {
      add({ framework: LABELS['cucumber-js'], command: 'npx cucumber-js', why: '@cucumber/cucumber in package.json' });
    }
  }

  if (fs.existsSync(path.join(cwd, 'pom.xml')) && /cucumber/i.test(fs.readFileSync(path.join(cwd, 'pom.xml'), 'utf8'))) {
    const wrapper = fs.existsSync(path.join(cwd, 'mvnw')) ? (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn';
    add({ framework: LABELS.maven, command: `${wrapper} test`, why: 'cucumber dependency in pom.xml' });
  }
  return found;
}

export const CONFIG_TEMPLATE = `# Hookyy configuration (all options are described in the README)
rules:
  slow:
    threshold: 1000   # ms; compared to each hook's median run
  cost:
    minTotal: 30000   # ms a per-scenario hook may add up to before it's reported
  tagMismatch:
    enabled: true

# Hooks you don't control (framework internals) or don't want audited
ignore: []

# Declare the tag scope each hook is *meant* to have; Hookyy reports runs outside it
hookTags: {}
`;

/** Add a `test:hooks` script and a starter config (only what doesn't exist yet). */
export function writeInit(cwd: string, detection: Detection): string[] {
  const written: string[] = [];
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    pkg.scripts = pkg.scripts ?? {};
    if (!pkg.scripts['test:hooks']) {
      pkg.scripts['test:hooks'] = `hookyy run -- ${detection.command}`;
      const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
      written.push('package.json (script "test:hooks")');
    }
  }
  const configPath = path.join(cwd, 'hook-auditor.config.yml');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, CONFIG_TEMPLATE);
    written.push('hook-auditor.config.yml');
  }
  const gitignore = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignore) && !/^\.hookyy\/?$/m.test(fs.readFileSync(gitignore, 'utf8'))) {
    fs.appendFileSync(gitignore, `${fs.readFileSync(gitignore, 'utf8').endsWith('\n') ? '' : '\n'}.hookyy/\n`);
    written.push('.gitignore (.hookyy/)');
  }
  return written;
}

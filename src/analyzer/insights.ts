import type { HookAnalysis, HookInsight } from '../types';
import { readHookBody } from './source';

/**
 * Recognise what a hook does from its source, so issues can say *why* it's slow and *what* to change.
 *
 * Every pattern here comes from the field test (docs/field-test.md): each one was the cause of a real
 * SLOW finding in a public project. Matching is deliberately conservative: comments are stripped and a
 * pattern only fires on the call that does the work, not on a variable name.
 */
interface Pattern {
  kind: HookInsight['kind'];
  test: RegExp;
  label: string;
  /** Fix for a per-scenario hook (before/after). */
  fix: string;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'browser-launch',
    test: /\b(?:chromium|firefox|webkit|browserType|playwright\.\w+\(\))\s*\.\s*launch\w*\s*\(|\bnew\s+(?:Chrome|Firefox|Edge|Safari|Remote)(?:Web)?Driver\s*\(|\bpuppeteer\s*\.\s*launch\s*\(|\bWebDriverManager\b|\blaunchBrowser\s*\(/,
    label: 'starts a browser for every scenario',
    fix: 'Launch the browser once (BeforeAll or a worker-scoped fixture) and open a fresh context/page per scenario instead.',
  },
  {
    kind: 'ui-login',
    test: /\b(?:log_?in|sign_?in|authenticate)\w*\s*\(|\.fill\(\s*[^,]*pass(?:word)?|\b(?:enter|type|set)Password\s*\(|\b(?:enter|type|set)Username\s*\(/i,
    label: 'logs in through the UI in every test',
    fix: 'Log in once and reuse the session: Playwright storageState, a saved auth cookie, or an API login.',
  },
  {
    kind: 'tracing',
    test: /\btracing\s*\.\s*(?:start|stop)\s*\(|\brecordVideo\b|\.video\(\)|\btakeScreenshot\w*\s*\(|\.screenshot\s*\(/,
    // Often conditional (env flag, only on failure), which can't be seen statically: keep the wording neutral.
    label: 'captures traces, videos or screenshots',
    fix: 'Make sure artifacts are only captured when needed: on failure (check the scenario status, or use retain-on-failure), not on every run.',
  },
  {
    kind: 'data-setup',
    test: /\b(?:seed|truncate|resetDatabase|resetDb|cleanDatabase|migrate)\w*\s*\(|\b(?:knex|prisma|sequelize|typeorm)\b|\bexecuteSql\s*\(/i,
    label: 'resets or seeds data before every test',
    fix: 'Seed once per worker, wrap each test in a transaction, or scope the hook with tags to the tests that need it.',
  },
  {
    kind: 'navigation',
    // Includes page-object calls like inventoryPage.visit() (field test: ecureuill/saucedemo-playwright).
    test: /\.goto\s*\(|\.visit\w*\s*\(|\b(?:navigate|open)\w*(?:Page|To|Url|Home)?\s*\(|\.get\(\s*['"`]https?:|driver\s*\.\s*(?:get|navigate)\b/i,
    label: 'loads a page before every test',
    fix: 'Navigate only in the tests that need that page, start from a lighter page, or set up state via API before navigating.',
  },
  {
    kind: 'fixed-wait',
    test: /\bwaitForTimeout\s*\(|\bThread\s*\.\s*sleep\s*\(|\bsleep\s*\(|new Promise\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*setTimeout\s*\(|\bcy\s*\.\s*wait\s*\(\s*\d/,
    label: 'contains a fixed wait',
    fix: 'Replace the fixed wait with waiting for the condition you need (an element, a response, a state).',
  },
];

/** Strip comments so commented-out code doesn't match. */
function code(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function hookInsights(hook: Pick<HookAnalysis, 'location' | 'name'>, rootDir: string): HookInsight[] {
  const body = readHookBody(hook.location ?? hook.name, rootDir);
  if (!body) return [];
  const src = code(body);
  return PATTERNS.filter((p) => p.test.test(src)).map(({ kind, label, fix }) => ({ kind, label, fix }));
}

/** Recommendation text for a costly/slow per-scenario hook, using insights when available. */
export function recommendationFor(hook: Pick<HookAnalysis, 'type' | 'insights'>, fallback: string): string {
  const insights = hook.insights ?? [];
  if (!insights.length) return fallback;
  const perScenario = hook.type === 'before' || hook.type === 'after';
  const what = insights.map((i) => i.label).join(', ');
  const fixes = insights.map((i) => i.fix).join(' ');
  const text = perScenario ? what : what.replace(/ for every scenario| in every test| before every test/g, '');
  return `This hook ${text}. ${fixes}`;
}

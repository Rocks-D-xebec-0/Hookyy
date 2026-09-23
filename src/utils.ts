import * as fs from 'fs';
import * as path from 'path';
import type { Severity } from './types';

export class HookyyError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = 'HookyyError';
  }
}

export const SEVERITY_RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export function isSeverity(value: unknown): value is Severity {
  return value === 'error' || value === 'warning' || value === 'info';
}

export function readJsonFile(filePath: string): unknown {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new HookyyError(`Report not found: ${abs}`, 'Check the path, and make sure your tests ran with a JSON reporter.');
  }
  const raw = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) {
    throw new HookyyError(`Report is empty: ${abs}`, 'Did the test run finish before the report was written?');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Cucumber Messages are newline-delimited JSON (one envelope per line).
    const ndjson = parseNdjson(raw);
    if (ndjson) return ndjson;
    throw new HookyyError(
      `Report is not valid JSON: ${abs} (${(err as Error).message})`,
      'Hookyy reads JSON reports. For Cypress, use the cucumber preprocessor JSON output.',
    );
  }
}

function parseNdjson(raw: string): unknown[] | undefined {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return undefined;
  try {
    return lines.map((l) => JSON.parse(l));
  } catch {
    return undefined;
  }
}

/**
 * Resolve report arguments to files: plain files, directories (every .json/.ndjson inside,
 * non-recursive) and wildcards in the file name (`reports/*.ndjson`, `out/run-?.json`).
 * Wildcards are expanded here so they also work in shells that don't expand them (Windows).
 */
export function expandReportPaths(paths: string[], cwd: string = process.cwd()): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const abs = path.resolve(cwd, p);
    const base = path.basename(abs);
    if (/[*?]/.test(base)) {
      const dir = path.dirname(abs);
      const re = wildcardToRegExp(base);
      const matches = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : [];
      if (!matches.length) throw new HookyyError(`No report matches ${abs}`, 'Check the pattern, and that your tests wrote their reports.');
      files.push(...matches.map((f) => path.join(dir, f)));
    } else if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const matches = fs.readdirSync(abs).filter((f) => /\.(ndjson|json)$/i.test(f)).sort();
      if (!matches.length) throw new HookyyError(`No .json or .ndjson reports in ${abs}`);
      files.push(...matches.map((f) => path.join(abs, f)));
    } else {
      files.push(abs);
    }
  }
  return Array.from(new Set(files));
}

function wildcardToRegExp(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += /[\\^$.|+()[\]{}]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${source}$`, 'i');
}

export function writeOutputFile(filePath: string, content: string): string {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

/** Cucumber reports durations in nanoseconds; convert to ms. */
export function nsToMs(ns: number | undefined): number {
  if (typeof ns !== 'number' || !isFinite(ns) || ns < 0) return 0;
  return ns / 1e6;
}

export function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function formatMs(ms: number): string {
  if (ms >= 60000) {
    const m = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return sec ? `${m}m ${sec}s` : `${m}m`;
  }
  if (ms >= 1000) return `${round(ms / 1000, 2)}s`;
  return `${round(ms, 1)}ms`;
}

export function normalizeTag(tag: string): string {
  const t = tag.trim();
  return t.startsWith('@') ? t : `@${t}`;
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeMarkdownCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Substring match used for `ignore`, `expectedHooks` and `hookTags` keys. */
export function matchesHook(pattern: string, hookName: string, location?: string): boolean {
  return hookName.includes(pattern) || (!!location && location.includes(pattern));
}

// ---------------------------------------------------------------------------
// Tag expressions (Cucumber syntax): "@a and not (@b or @c)"
// ---------------------------------------------------------------------------

type TagNode =
  | { kind: 'tag'; name: string }
  | { kind: 'not'; operand: TagNode }
  | { kind: 'and' | 'or'; left: TagNode; right: TagNode };

export type TagPredicate = (tags: string[]) => boolean;

export function parseTagExpression(expression: string): TagPredicate {
  const tokens = expression
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .split(/\s+/)
    .filter(Boolean);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr(): TagNode {
    let left = parseAnd();
    while (peek()?.toLowerCase() === 'or') {
      next();
      left = { kind: 'or', left, right: parseAnd() };
    }
    return left;
  }
  function parseAnd(): TagNode {
    let left = parseUnary();
    while (peek()?.toLowerCase() === 'and') {
      next();
      left = { kind: 'and', left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary(): TagNode {
    const tok = next();
    if (tok === undefined) throw new HookyyError(`Invalid tag expression: "${expression}" (unexpected end)`);
    if (tok.toLowerCase() === 'not') return { kind: 'not', operand: parseUnary() };
    if (tok === '(') {
      const inner = parseOr();
      if (next() !== ')') throw new HookyyError(`Invalid tag expression: "${expression}" (missing ")")`);
      return inner;
    }
    if (tok === ')' || ['and', 'or'].includes(tok.toLowerCase())) {
      throw new HookyyError(`Invalid tag expression: "${expression}" (unexpected "${tok}")`);
    }
    return { kind: 'tag', name: normalizeTag(tok) };
  }

  const ast = parseOr();
  if (pos < tokens.length) {
    throw new HookyyError(`Invalid tag expression: "${expression}" (unexpected "${tokens[pos]}")`);
  }

  const evaluate = (node: TagNode, tags: Set<string>): boolean => {
    switch (node.kind) {
      case 'tag':
        return tags.has(node.name);
      case 'not':
        return !evaluate(node.operand, tags);
      case 'and':
        return evaluate(node.left, tags) && evaluate(node.right, tags);
      case 'or':
        return evaluate(node.left, tags) || evaluate(node.right, tags);
    }
  };

  return (tags) => evaluate(ast, new Set(tags.map(normalizeTag)));
}

// ---------------------------------------------------------------------------
// Hook source inspection: read `Before({ tags: '@x' }, ...)` from source files
// ---------------------------------------------------------------------------

const sourceCache = new Map<string, string[] | null>();

/**
 * Given a location like "features/support/hooks.ts:12", read the hook
 * declaration at that line and return its tag expression if one is declared.
 */
export function readHookTagsFromSource(location: string | undefined, rootDir: string): string | undefined {
  if (!location) return undefined;
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(location.trim());
  if (!m) return undefined;
  const [, file, lineStr] = m;
  const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);

  let lines = sourceCache.get(abs);
  if (lines === undefined) {
    try {
      lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    } catch {
      lines = null;
    }
    sourceCache.set(abs, lines);
  }
  if (!lines) return undefined;

  const start = Math.max(0, Number(lineStr) - 1);
  // A declaration may span a few lines: Before(\n  { tags: '@x' },\n ...)
  const snippet = lines.slice(start, start + 4).join(' ');
  const objectForm = /tags\s*:\s*(['"`])([^'"`]+)\1/.exec(snippet);
  if (objectForm) return objectForm[2].trim();
  // Legacy string form: Before('@tag', function () {...})
  const stringForm = /\b(?:Before|After|BeforeAll|AfterAll)\s*\(\s*(['"`])(@[^'"`]+)\1/.exec(snippet);
  if (stringForm) return stringForm[2].trim();
  return undefined;
}

export function clearSourceCache(): void {
  sourceCache.clear();
}

/**
 * Share of test time spent in hooks, or undefined when the report's test durations can't support it
 * (no timings, or durations that don't include hook time, e.g. tests skipped or crashed early).
 */
export function hookShare(summary: { totalTestTime: number; totalHookTime: number }): number | undefined {
  if (summary.totalTestTime <= 0 || summary.totalHookTime <= 0 || summary.totalHookTime > summary.totalTestTime) return undefined;
  return summary.totalHookTime / summary.totalTestTime;
}

/** First non-empty line of an error message, without ANSI colours, capped at 300 characters. */
export function firstLine(text?: string): string | undefined {
  if (!text) return undefined;
  // Strip ANSI colour codes (Playwright adds them to error messages).
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim());
  return line ? line.trim().slice(0, 300) : undefined;
}

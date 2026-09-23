import * as fs from 'fs';
import * as path from 'path';

const cache = new Map<string, string[] | null>();

function readLines(file: string): string[] | null {
  let lines = cache.get(file);
  if (lines === undefined) {
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
      lines = null;
    }
    cache.set(file, lines);
  }
  return lines;
}

export function clearHookSourceCache(): void {
  cache.clear();
  javaIndex.clear();
}

/**
 * Return the source of a hook's body, best effort, or undefined if it can't be found.
 *
 * Supported locations:
 *  - `path/to/file.ts:12` (cucumber-js, Playwright reporter, Cucumber JSON): body from that line
 *  - `com.acme.Hooks.setUp()` / `com.acme.Hooks.setUp(io.cucumber.java.Scenario)` (Cucumber-JVM):
 *    the method body, found by locating Hooks.java under the project
 */
export function readHookBody(location: string | undefined, rootDir: string): string | undefined {
  if (!location) return undefined;

  const fileLine = /^(.*?\.(?:[cm]?[jt]sx?|java|kt|rb|py)):(\d+)(?::\d+)?$/i.exec(location.trim());
  if (fileLine) {
    const [, file, line] = fileLine;
    const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);
    const lines = readLines(abs);
    return lines ? extractBlock(lines, Number(line) - 1) : undefined;
  }

  const javaMethod = /^([\w$.]+)\.([\w$<>]+)\(([^)]*)\)$/.exec(location.trim());
  if (javaMethod) {
    const [, className, method] = javaMethod;
    const file = findJavaFile(className, rootDir);
    const lines = file ? readLines(file) : null;
    if (!lines) return undefined;
    // A declaration has a return type or modifier before the name (a call doesn't).
    const declRe = new RegExp(`\\b(?:void|public|private|protected|static|final|[\\w$<>\\[\\],]+)\\s+${escapeRe(method)}\\s*\\(`);
    const decl = lines.findIndex((l) => declRe.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/\breturn\b|=/.test(l.split('(')[0]));
    return decl >= 0 ? extractBlock(lines, decl) : undefined;
  }
  return undefined;
}

/** From `start`, return lines up to the end of the first balanced `{ … }` block (max 80 lines). */
function extractBlock(lines: string[], start: number): string | undefined {
  if (start < 0 || start >= lines.length) return undefined;
  let depth = 0;
  let opened = false;
  const out: string[] = [];
  for (let i = start; i < Math.min(lines.length, start + 80); i++) {
    const line = stripStrings(lines[i]);
    out.push(lines[i]);
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (opened && depth <= 0) break;
  }
  return out.join('\n');
}

/** Blank out string/comment contents so braces inside them don't affect block matching. */
function stripStrings(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
}

const javaIndex = new Map<string, Map<string, string>>(); // rootDir -> simple class name -> file

function findJavaFile(className: string, rootDir: string): string | undefined {
  // Fast path: package path under the usual source roots.
  const rel = className.replace(/\./g, '/') + '.java';
  for (const base of ['src/test/java', 'src/main/java', 'src/it/java', '.']) {
    const candidate = path.join(rootDir, base, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: index .java files by simple class name (bounded walk).
  let index = javaIndex.get(rootDir);
  if (!index) {
    index = new Map();
    walk(path.join(rootDir, 'src'), index, 0);
    javaIndex.set(rootDir, index);
  }
  return index.get(className.split('.').pop()!);
}

function walk(dir: string, index: Map<string, string>, depth: number): void {
  if (depth > 12 || index.size > 5000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, index, depth + 1);
    else if (e.name.endsWith('.java') && !index.has(e.name.slice(0, -5))) index.set(e.name.slice(0, -5), p);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

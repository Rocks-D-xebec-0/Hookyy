import type { ParsedTestData } from '../types';

export interface ParserOptions {
  /** Directory used to resolve hook source files (for reading tag expressions). */
  rootDir?: string;
}

/**
 * Extend this class to support a new report format, then register it with
 * `registerParser()` so auto-detection and `--parser <name>` can find it.
 */
export abstract class BaseParser {
  /** Unique name used by `--parser`. */
  abstract readonly name: string;
  /** Alternative names accepted by `--parser`. */
  readonly aliases: string[] = [];

  /** Return true if `data` looks like a report this parser understands. */
  abstract detect(data: unknown): boolean;

  /** Convert a raw report into Hookyy's framework-neutral model. */
  abstract parse(data: unknown, options?: ParserOptions): ParsedTestData;

  matches(name: string): boolean {
    const n = name.toLowerCase();
    return n === this.name || this.aliases.includes(n);
  }
}

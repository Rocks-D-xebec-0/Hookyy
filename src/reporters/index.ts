import type { ReporterType } from '../types';
import { HookyyError } from '../utils';
import { BaseReporter } from './BaseReporter';
import { CLIReporter } from './CLIReporter';
import { HTMLReporter } from './HTMLReporter';
import { JSONReporter } from './JSONReporter';
import { MarkdownReporter } from './MarkdownReporter';

export { BaseReporter, CLIReporter, HTMLReporter, JSONReporter, MarkdownReporter };
export type { ReporterOptions } from './BaseReporter';
export { serializeResult } from './serialize';
export type { SerializedResult, SerializedHook } from './serialize';

const factories: Record<string, () => BaseReporter> = {
  cli: () => new CLIReporter(),
  html: () => new HTMLReporter(),
  json: () => new JSONReporter(),
  markdown: () => new MarkdownReporter(),
  md: () => new MarkdownReporter(),
};

export function registerReporter(type: string, factory: () => BaseReporter): void {
  factories[type] = factory;
}

export function createReporter(type: ReporterType | string): BaseReporter {
  const factory = factories[type];
  if (!factory) {
    throw new HookyyError(`Unknown format "${type}".`, `Available formats: ${Object.keys(factories).join(', ')}`);
  }
  return factory();
}

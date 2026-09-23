import type { AnalysisResult } from '../types';
import { BaseReporter, ReporterOptions } from './BaseReporter';
import { serializeResult } from './serialize';

export class JSONReporter extends BaseReporter {
  readonly type = 'json' as const;
  readonly extension = 'json';

  render(result: AnalysisResult, options: ReporterOptions = {}): string {
    return JSON.stringify(serializeResult(result, options.verbose ?? true), null, 2) + '\n';
  }
}

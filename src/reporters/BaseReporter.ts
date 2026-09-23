import type { AnalysisResult, ReporterType } from '../types';

export interface ReporterOptions {
  verbose?: boolean;
  /** Disable ANSI colors (CLI reporter). */
  color?: boolean;
}

export abstract class BaseReporter {
  abstract readonly type: ReporterType;
  /** Default file extension when writing to disk. */
  abstract readonly extension: string;

  /** Render the analysis result to a string (terminal text, HTML, JSON…). */
  abstract render(result: AnalysisResult, options?: ReporterOptions): string;
}

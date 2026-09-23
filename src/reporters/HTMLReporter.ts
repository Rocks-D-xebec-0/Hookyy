import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisResult } from '../types';
import { HookyyError } from '../utils';
import { BaseReporter, ReporterOptions } from './BaseReporter';
import { serializeResult } from './serialize';

const DATA_PLACEHOLDER = '/*__HOOKYY_DATA__*/null';
/** Line/paragraph separators are valid in JSON but break older JS parsers. */
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** Self-contained, interactive HTML dashboard (single file, no external assets). */
export class HTMLReporter extends BaseReporter {
  readonly type = 'html' as const;
  readonly extension = 'html';

  constructor(private readonly templatePath?: string) {
    super();
  }

  render(result: AnalysisResult, options: ReporterOptions = {}): string {
    const template = fs.readFileSync(this.templatePath ?? resolveTemplate(), 'utf8');
    if (!template.includes(DATA_PLACEHOLDER)) {
      throw new HookyyError('HTML template is missing the data placeholder.', `Expected "${DATA_PLACEHOLDER}" in the template.`);
    }
    // Escape "<" so the payload can never close the <script> tag.
    const json = JSON.stringify(serializeResult(result, options.verbose ?? true))
      .replace(/</g, '\\u003c')
      .replace(LINE_SEPARATORS, (ch) => '\\u' + ch.charCodeAt(0).toString(16));
    return template.replace(DATA_PLACEHOLDER, () => json);
  }
}

/** Find templates/dashboard.html both from dist/ (published) and src/ (dev/tests). */
function resolveTemplate(): string {
  const candidates = [
    path.resolve(__dirname, '../templates/dashboard.html'),
    path.resolve(__dirname, '../../templates/dashboard.html'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new HookyyError('HTML template not found.', `Looked in: ${candidates.join(', ')}`);
  return found;
}

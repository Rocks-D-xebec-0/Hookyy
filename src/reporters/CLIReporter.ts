import Table from 'cli-table3';
import pc from 'picocolors';
import type { AnalysisResult, Severity } from '../types';
import { formatMs, hookShare } from '../utils';
import { BaseReporter, ReporterOptions } from './BaseReporter';
import { describeEvidence } from './MarkdownReporter';
import { topHooks } from './serialize';

type Colors = ReturnType<typeof pc.createColors>;

export class CLIReporter extends BaseReporter {
  readonly type = 'cli' as const;
  readonly extension = 'txt';

  render(result: AnalysisResult, options: ReporterOptions = {}): string {
    const c: Colors = pc.createColors(options.color ?? pc.isColorSupported);
    const s = result.summary;
    const sev: Record<Severity, (t: string) => string> = { error: c.red, warning: c.yellow, info: c.blue };
    const out: string[] = [];

    out.push('', c.bold('🪝 Hookyy: hook audit'), '');
    out.push(
      `${c.dim('Framework')} ${result.framework}   ${c.dim('Hooks')} ${s.totalHooks}   ${c.dim('Scenarios')} ${s.totalScenarios}   ${c.dim('Executions')} ${s.totalExecutions}`,
    );

    for (const w of result.warnings ?? []) out.push('', c.yellow(`⚠ ${w}`));

    // Where the time goes: the headline number and the biggest hooks.
    const share = hookShare(s);
    const top = topHooks(result);
    if (top.length) {
      out.push(
        '',
        share !== undefined
          ? `${c.bold('Hooks took')} ${c.bold(formatMs(s.totalHookTime))} of ${formatMs(s.totalTestTime)} test time ${c.bold(`(${Math.round(share * 100)}%)`)}`
          : `${c.bold('Hooks took')} ${c.bold(formatMs(s.totalHookTime))}`,
      );
      const costs = new Table({
        head: ['Costliest hooks', 'Runs', 'Total', 'What it does'].map((h) => c.bold(h)),
        colWidths: [52, 7, 10, 52],
        wordWrap: true,
        style: { head: [], border: [] },
      });
      for (const h of top) {
        costs.push([
          { content: h.name, wrapOnWordBoundary: false },
          h.executions.filter((e) => !e.skipped).length,
          formatMs(h.totalDuration),
          h.insights.map((i) => i.label).join('; ') || c.dim('-'),
        ]);
      }
      out.push(costs.toString());
    }

    if (s.issuesFound === 0 && s.totalHooks === 0 && (result.warnings ?? []).length) {
      out.push('', c.yellow('No hooks could be audited from this report (see the warning above).'), '');
    } else if (s.issuesFound === 0 && s.totalHooks === 0) {
      out.push('', c.yellow('No hooks found in this report, so there was nothing to audit.'), '');
    } else if (s.issuesFound === 0) {
      out.push('', c.green('✔ No hook issues found.'), '');
    } else {
      const table = new Table({
        head: ['Severity', 'Code', 'Hook', 'Message'].map((h) => c.bold(h)),
        colWidths: [10, 14, 38, 60],
        wordWrap: true,
        style: { head: [], border: [] },
      });
      for (const i of result.issues) {
        // Hook names are often long tokens without spaces (paths, Java methods): hard-wrap that cell only.
        table.push([sev[i.severity](i.severity), i.code, { content: i.hookName, wrapOnWordBoundary: false }, i.message]);
      }
      out.push('', table.toString());

      if (options.verbose) {
        out.push('', c.bold('Recommendations'));
        for (const i of result.issues) {
          out.push(`  ${sev[i.severity]('●')} ${c.bold(i.code)} ${i.hookName}`);
          out.push(`    ${i.recommendation}`);
          for (const e of i.evidence.slice(0, 5)) out.push(c.dim(`      - ${describeEvidence(e)}`));
          if (i.evidence.length > 5) out.push(c.dim(`      …and ${i.evidence.length - 5} more`));
        }
      } else {
        out.push(c.dim('  Run with --verbose for recommendations and evidence.'));
      }

      out.push(
        '',
        `${c.bold(`${s.issuesFound} issue(s)`)}: ${c.red(`${s.errorCount} error`)}, ${c.yellow(`${s.warningCount} warning`)}, ${c.blue(`${s.infoCount} info`)}`,
      );
    }

    if (options.verbose && result.hooks.size) {
      const hooks = new Table({
        head: ['Hook', 'Type', 'Runs', 'Median', 'Max', 'Total', 'Issues'].map((h) => c.bold(h)),
        style: { head: [], border: [] },
      });
      const sorted = Array.from(result.hooks.values()).sort((a, b) => b.totalDuration - a.totalDuration);
      for (const h of sorted) {
        hooks.push([
          h.name,
          h.type,
          h.executions.length,
          formatMs(h.medianDuration),
          formatMs(h.maxDuration),
          formatMs(h.totalDuration),
          h.issues.map((i) => i.code).join(', ') || c.green('ok'),
        ]);
      }
      out.push('', c.bold('Hooks'), hooks.toString());
    }

    out.push(c.dim(`Analyzed in ${result.executionTime}ms`), '');
    return out.join('\n');
  }
}

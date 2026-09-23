import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src';
import { HTMLReporter } from '../../src/reporters';
import { CUCUMBER_ROOT, fixture } from '../helpers';

/** Load the generated dashboard and execute its inline script. */
function openDashboard() {
  const { result } = analyze({ reportPath: fixture('cucumber-report.json'), config: { rootDir: CUCUMBER_ROOT } });
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (e) => errors.push(String(e)));
  const dom = new JSDOM(new HTMLReporter().render(result), {
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      (window as any).matchMedia = () => ({ matches: false });
    },
  });
  return { doc: dom.window.document, window: dom.window, errors };
}

describe('HTML dashboard (runtime)', () => {
  it('renders summary cards, issues and hooks without script errors', () => {
    const { doc, errors } = openDashboard();
    expect(errors).toEqual([]);
    const cards = Array.from(doc.querySelectorAll('.card')).map((c) => c.textContent);
    expect(cards).toContain('Hooks5');
    expect(cards).toContain('Errors1');
    expect(doc.querySelectorAll('#issues details.issue')).toHaveLength(4);
    expect(doc.querySelectorAll('#hookBody tr')).toHaveLength(5);
  });

  it('filters issues by severity chip and search text', () => {
    const { doc, window } = openDashboard();
    const errorChip = doc.querySelector<HTMLButtonElement>('#sevFilters button[data-v="error"]')!;
    errorChip.click();
    expect(errorChip.getAttribute('aria-pressed')).toBe('true');
    expect(doc.querySelectorAll('#issues details.issue')).toHaveLength(1);
    errorChip.click();

    const search = doc.querySelector<HTMLInputElement>('#search')!;
    search.value = 'voucher';
    search.dispatchEvent(new window.Event('input'));
    const shown = Array.from(doc.querySelectorAll('#issues .code')).map((e) => e.textContent);
    expect(shown).toEqual(['ORPHANED']);

    search.value = 'zzz-no-match';
    search.dispatchEvent(new window.Event('input'));
    expect(doc.querySelector('#issues')!.textContent).toContain('No issues match');
  });

  it('shows parser warnings as a banner (escaped)', () => {
    const { result } = analyze({ reportPath: fixture('real/playwright-json-angelo.json'), config: {} });
    result.warnings.push('<img src=x onerror=alert(1)>');
    const dom = new JSDOM(new HTMLReporter().render(result), {
      runScripts: 'dangerously',
      beforeParse(window) {
        (window as any).matchMedia = () => ({ matches: false });
      },
    });
    const banners = Array.from(dom.window.document.querySelectorAll('#warnings .warn')).map((e) => e.textContent);
    expect(banners[0]).toContain('hookyy/playwright-reporter');
    expect(dom.window.document.querySelector('#warnings img')).toBeNull();
  });

  it('sorts the hooks table when a header is clicked', () => {
    const { doc } = openDashboard();
    const firstHook = () => doc.querySelector('#hookBody tr td')!.firstChild!.textContent;
    expect(firstHook()).toBe('features/support/hooks.js:5'); // default: total time desc
    doc.querySelector<HTMLElement>('th[data-k="name"]')!.click();
    expect(firstHook()).toBe('features/support/hooks.js:12');
    expect(doc.querySelector('th[data-k="name"]')!.getAttribute('aria-sort')).toBe('ascending');
  });
});

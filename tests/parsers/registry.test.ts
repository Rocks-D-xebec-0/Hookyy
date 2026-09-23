import { describe, expect, it } from 'vitest';
import { BaseParser, detectParser, getParser, registerParser } from '../../src/parsers';
import type { ParsedTestData } from '../../src/types';

describe('parser registry', () => {
  it('resolves parsers by name and alias', () => {
    expect(getParser('cucumber').name).toBe('cucumber');
    expect(getParser('Cypress').name).toBe('cucumber');
    expect(getParser('playwright').name).toBe('playwright');
  });

  it('throws on unknown parser names with the list of options', () => {
    expect(() => getParser('jest')).toThrow(/Unknown parser "jest"/);
  });

  it('auto-detects formats', () => {
    expect(detectParser([{ elements: [] }]).name).toBe('cucumber');
    expect(detectParser({ suites: [], config: {} }).name).toBe('playwright');
    expect(() => detectParser({ foo: 1 })).toThrow(/Could not detect/);
  });

  it('lets users register custom parsers with priority', () => {
    class MyParser extends BaseParser {
      readonly name = 'mine';
      detect(d: unknown) {
        return typeof d === 'object' && d !== null && 'myFormat' in d;
      }
      parse(): ParsedTestData {
        return { framework: 'mine', scenarios: [] };
      }
    }
    registerParser(new MyParser());
    expect(detectParser({ myFormat: true }).name).toBe('mine');
    expect(getParser('mine').name).toBe('mine');
  });
});

import { describe, expect, it } from 'vitest';
import { formatMs, nsToMs, parseTagExpression, readHookTagsFromSource } from '../../src/utils';
import { CUCUMBER_ROOT } from '../helpers';

describe('parseTagExpression', () => {
  const t = (expr: string, tags: string[]) => parseTagExpression(expr)(tags);

  it('evaluates single tags, with or without @', () => {
    expect(t('@db', ['@db'])).toBe(true);
    expect(t('db', ['@db'])).toBe(true);
    expect(t('@db', ['db'])).toBe(true);
    expect(t('@db', ['@smoke'])).toBe(false);
  });

  it('handles and / or / not with precedence and parentheses', () => {
    expect(t('@a or @b and @c', ['@a'])).toBe(true);
    expect(t('(@a or @b) and @c', ['@a'])).toBe(false);
    expect(t('@a and not @wip', ['@a', '@wip'])).toBe(false);
    expect(t('not (@a or @b)', ['@c'])).toBe(true);
    expect(t('@A AND NOT @B', ['@A'])).toBe(true);
  });

  it('throws on malformed expressions', () => {
    expect(() => parseTagExpression('@a and')).toThrow();
    expect(() => parseTagExpression('(@a')).toThrow();
    expect(() => parseTagExpression('@a @b')).toThrow();
    expect(() => parseTagExpression('')).toThrow();
  });
});

describe('readHookTagsFromSource', () => {
  it('reads tags at the hook line', () => {
    expect(readHookTagsFromSource('features/support/hooks.js:5', CUCUMBER_ROOT)).toBe('@db');
    expect(readHookTagsFromSource('features/support/hooks.js:40', CUCUMBER_ROOT)).toBe('@payments');
    expect(readHookTagsFromSource('features/support/hooks.js:12', CUCUMBER_ROOT)).toBeUndefined();
  });

  it('returns undefined for missing files or malformed locations', () => {
    expect(readHookTagsFromSource('nope.js:1', CUCUMBER_ROOT)).toBeUndefined();
    expect(readHookTagsFromSource('no-line-number', CUCUMBER_ROOT)).toBeUndefined();
    expect(readHookTagsFromSource(undefined, CUCUMBER_ROOT)).toBeUndefined();
  });
});

describe('formatting helpers', () => {
  it('converts and formats durations', () => {
    expect(nsToMs(1_500_000)).toBe(1.5);
    expect(nsToMs(undefined)).toBe(0);
    expect(formatMs(12.34)).toBe('12.3ms');
    expect(formatMs(2500)).toBe('2.5s');
  });
});

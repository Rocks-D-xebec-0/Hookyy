import type { Config } from '../types';

export const DEFAULT_SLOW_THRESHOLD_MS = 1000;

export function defaultConfig(): Config {
  return {
    rules: {
      failing: { enabled: true, severity: 'error' },
      orphaned: { enabled: true, severity: 'warning' },
      unused: { enabled: true, severity: 'warning' },
      slow: { enabled: true, threshold: DEFAULT_SLOW_THRESHOLD_MS, metric: 'median', severity: 'warning' },
      cost: { enabled: true, minTotal: 30000, minShare: 0.1, minRuns: 3, severity: 'warning' },
      tagMismatch: { enabled: true, severity: 'error' },
    },
    reporters: [{ type: 'cli' }],
    expectedHooks: [],
    hookTags: {},
    ignore: [],
  };
}

export const CONFIG_FILE_NAMES = [
  'hook-auditor.config.yml',
  'hook-auditor.config.yaml',
  'hookyy.config.yml',
  'hookyy.config.yaml',
  '.hookyyrc.yml',
];

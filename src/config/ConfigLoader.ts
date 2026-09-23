import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { Config, PartialConfig, ReporterConfig } from '../types';
import { HookyyError, isSeverity } from '../utils';
import { CONFIG_FILE_NAMES, defaultConfig } from './DefaultConfig';

const REPORTER_TYPES = ['cli', 'html', 'json', 'markdown'];
const RULE_KEYS = ['failing', 'orphaned', 'unused', 'slow', 'cost', 'tagMismatch'] as const;

/** Look for a config file in `dir` using the standard names. */
export function findConfigFile(dir: string = process.cwd()): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Load config: defaults <- YAML file (explicit path, or auto-discovered in cwd).
 * Throws a HookyyError with a helpful message for missing/invalid files.
 */
export function loadConfig(configPath?: string, cwd: string = process.cwd()): { config: Config; source?: string } {
  const file = configPath ? path.resolve(cwd, configPath) : findConfigFile(cwd);
  if (!file) return { config: defaultConfig() };
  if (!fs.existsSync(file)) throw new HookyyError(`Config file not found: ${file}`);

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new HookyyError(`Invalid YAML in ${file}: ${(err as Error).message}`);
  }
  if (raw == null) return { config: defaultConfig(), source: file };

  const config = mergeConfig(defaultConfig(), validateConfig(raw, file));
  config.rootDir = config.rootDir ? path.resolve(path.dirname(file), config.rootDir) : path.dirname(file);
  return { config, source: file };
}

export function mergeConfig(base: Config, override: PartialConfig): Config {
  const merged = {
    ...base,
    ...override,
    rules: { ...base.rules },
    reporters: override.reporters ?? base.reporters,
  } as Config;
  for (const key of RULE_KEYS) {
    (merged.rules as any)[key] = { ...base.rules[key], ...(override.rules?.[key] ?? {}) };
  }
  return merged;
}

export function validateConfig(raw: unknown, source = 'config'): PartialConfig {
  const fail = (msg: string): never => {
    throw new HookyyError(`Invalid config (${source}): ${msg}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('expected a mapping at the top level');
  const cfg = raw as Record<string, any>;

  if (cfg.rules !== undefined) {
    if (typeof cfg.rules !== 'object' || cfg.rules === null) fail('"rules" must be a mapping');
    for (const [key, rule] of Object.entries<any>(cfg.rules)) {
      if (!(RULE_KEYS as readonly string[]).includes(key)) {
        fail(`unknown rule "${key}" (expected one of ${RULE_KEYS.join(', ')})`);
      }
      if (typeof rule !== 'object' || rule === null) fail(`rules.${key} must be a mapping`);
      if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') fail(`rules.${key}.enabled must be true or false`);
      if (rule.severity !== undefined && !isSeverity(rule.severity)) fail(`rules.${key}.severity must be error, warning or info`);
      if (key === 'slow' && rule.threshold !== undefined && (typeof rule.threshold !== 'number' || rule.threshold < 0)) {
        fail('rules.slow.threshold must be a non-negative number (milliseconds)');
      }
      if (key === 'cost') {
        for (const k of ['minTotal', 'minShare', 'minRuns']) {
          if (rule[k] !== undefined && (typeof rule[k] !== 'number' || rule[k] < 0)) fail(`rules.cost.${k} must be a non-negative number`);
        }
        if (rule.minShare !== undefined && rule.minShare > 1) fail('rules.cost.minShare is a fraction between 0 and 1 (e.g. 0.1 for 10%)');
      }
      if (key === 'slow' && rule.metric !== undefined && !['median', 'avg', 'max'].includes(rule.metric)) {
        fail('rules.slow.metric must be median, avg or max');
      }
    }
  }

  if (cfg.reporters !== undefined) {
    if (!Array.isArray(cfg.reporters)) fail('"reporters" must be a list');
    cfg.reporters = (cfg.reporters as any[]).map((r, i): ReporterConfig => {
      const rep = typeof r === 'string' ? { type: r } : r;
      if (!rep || !REPORTER_TYPES.includes(rep.type)) {
        fail(`reporters[${i}].type must be one of ${REPORTER_TYPES.join(', ')}`);
      }
      return rep;
    });
  }

  for (const key of ['expectedHooks', 'ignore'] as const) {
    const value = cfg[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((v: unknown) => typeof v !== 'string'))) {
      fail(`"${key}" must be a list of strings`);
    }
  }

  if (cfg.hookTags !== undefined) {
    if (typeof cfg.hookTags !== 'object' || cfg.hookTags === null || Array.isArray(cfg.hookTags)) {
      fail('"hookTags" must be a mapping of hook name/location to tag expression');
    }
    for (const [k, v] of Object.entries(cfg.hookTags)) {
      if (typeof v !== 'string') fail(`hookTags["${k}"] must be a string`);
    }
  }

  if (cfg.rootDir !== undefined && typeof cfg.rootDir !== 'string') fail('"rootDir" must be a string');
  return cfg as PartialConfig;
}

import * as path from 'path';
import type { HookExecution, ParsedTestData, ScenarioData } from '../src/types';

export const FIXTURES = path.join(__dirname, 'fixtures');
export const fixture = (name: string) => path.join(FIXTURES, name);
export const CUCUMBER_ROOT = fixture('cucumber-project');

export function exec(overrides: Partial<HookExecution> = {}): HookExecution {
  return {
    hookName: 'hooks.ts:1',
    type: 'before',
    scenarioName: 'Scenario A',
    scenarioTags: [],
    duration: 10,
    passed: true,
    skipped: false,
    ...overrides,
  };
}

export function scenario(name: string, hooks: Array<Partial<HookExecution>>, extra: Partial<ScenarioData> = {}): ScenarioData {
  const tags = extra.tags ?? [];
  const skipped = extra.skipped ?? false;
  return {
    name,
    tags,
    passed: !skipped,
    skipped,
    hooks: hooks.map((h) => exec({ scenarioName: name, scenarioTags: tags, scenarioSkipped: skipped, ...h })),
    ...extra,
  };
}

export function data(scenarios: ScenarioData[]): ParsedTestData {
  return { framework: 'test', scenarios };
}

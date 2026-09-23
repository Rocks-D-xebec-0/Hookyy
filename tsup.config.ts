import { defineConfig } from 'tsup';
import pkg from './package.json';

const define = { __HOOKYY_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    shims: true,
    target: 'node14',
    sourcemap: true,
    define,
  },
  {
    entry: { 'playwright-reporter': 'src/playwright/reporter.ts' },
    format: ['cjs'],
    dts: true,
    target: 'node14',
    // Export the class itself (and .default) so both require() and Playwright's loader work.
    footer: { js: 'module.exports = module.exports.default; module.exports.default = module.exports;' },
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['cjs'],
    target: 'node14',
    shims: true,
    define,
    banner: { js: '#!/usr/bin/env node' },
  },
]);

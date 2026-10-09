import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { paperclipCaseKernelAliases } from './scripts/paperclip-case-kernel-source.mjs'
import { defaultExclude, defineConfig } from 'vitest/config'
import { UNIT_INCLUDE, UNIT_EXCLUDE } from './scripts/ci-unit-files.mjs'
import TimingSequencer from './scripts/ci-unit-sequencer.mjs'
import RuntimeSequencer from './scripts/vitest-runtime-sequencer.mjs'
import { NODE_RUNTIME_INCLUDE } from './scripts/vitest-node-runtime-files.mjs'
import { nodeRuntimePool } from './scripts/vitest-node-runtime-pool'

const paperclipSource = resolve('logs/paperclip-p1/paperclip')
const checkoutAliases = existsSync(resolve(paperclipSource, 'packages/db/node_modules/drizzle-orm'))
  ? paperclipCaseKernelAliases(paperclipSource)
  : {}

const balancedShards = process.env.ORCA_BALANCE_UNIT_SHARDS === '1'
const measurementFile = 'src/main/foreign-sqlite-readers/foreign-sqlite-reader-event-loop.test.ts'
const transforms = {
  define: { ORCA_FEATURE_WALL_ENABLED: 'true' },
  resolve: {
    alias: {
      ...checkoutAliases,
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      '@hive-paperclip-external-execution': resolve(
        process.env.HIVE_PAPERCLIP_SOURCE
          ? resolve(process.env.HIVE_PAPERCLIP_SOURCE, 'server/src/services/external-execution.ts')
          : 'integration/paperclip/core/external-execution.ts'
      ),
      'fs/promises': 'node:fs/promises',
      fs: 'node:fs',
      os: 'node:os'
    }
  }
}
const testOptions = {
  environment: 'node',
  clearMocks: false,
  fsModuleCache: true,
  env: { ORCA_VITEST_RUNTIME: 'node' },
  server: { deps: { inline: ['zod'] } },
  // Node's storage globals and V8 retention checks require the existing child flags.
  execArgv: ['--no-experimental-webstorage', '--expose-gc'],
  setupFiles: [
    resolve('config/scripts/vitest-real-agent-home-write-guard.ts'),
    resolve('config/scripts/vitest-bun-node-builtins.ts'),
    resolve('config/scripts/happy-dom-offscreen-canvas.ts'),
    resolve('config/scripts/happy-dom-mutation-observer-retention.ts'),
    resolve('config/scripts/vitest-host-ports-setup.ts'),
    resolve('config/scripts/vitest-caller-identity-env-setup.ts')
  ],
  include: UNIT_INCLUDE,
  exclude: [...(balancedShards ? UNIT_EXCLUDE : defaultExclude), 'logs/**', '.tmp/**'],
  hookTimeout: 60_000,
  testTimeout: 30_000
}
const nodeProject = {
  extends: false,
  ...transforms,
  test: {
    ...testOptions,
    name: process.versions.bun ? 'node-runtime' : 'node',
    env: { ORCA_VITEST_RUNTIME: process.versions.bun ? 'node-runtime' : 'node' },
    include: process.versions.bun ? NODE_RUNTIME_INCLUDE : UNIT_INCLUDE,
    exclude: [...testOptions.exclude, measurementFile],
    sequence: { groupOrder: 1 },
    ...(process.versions.bun
      ? { pool: 'node-runtime', poolRunner: nodeRuntimePool }
      : { pool: 'forks' })
  }
}
const projects = [
  ...(process.versions.bun
    ? [
        {
          extends: false,
          ...transforms,
          test: {
            ...testOptions,
            name: 'bun',
            env: { ORCA_VITEST_RUNTIME: 'bun' },
            pool: 'forks',
            exclude: [...testOptions.exclude, ...NODE_RUNTIME_INCLUDE, measurementFile],
            sequence: { groupOrder: 1 }
          }
        }
      ]
    : []),
  nodeProject,
  // Keep the event-loop measurement free of other suites without weakening its limits.
  {
    ...nodeProject,
    test: {
      ...nodeProject.test,
      name: 'node-measurement',
      include: [measurementFile],
      exclude: testOptions.exclude,
      maxWorkers: 1,
      sequence: { groupOrder: 2 }
    }
  }
]

export default defineConfig({
  ...transforms,
  test: {
    ...testOptions,
    sequence: { sequencer: balancedShards ? TimingSequencer : RuntimeSequencer },
    ...(balancedShards
      ? {
          reporters: ['default', resolve('config/scripts/ci-unit-timing-reporter.mjs')]
        }
      : {}),
    projects,
    ...(process.platform === 'win32' ? { maxWorkers: 4 } : {})
  }
})

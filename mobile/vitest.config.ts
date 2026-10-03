import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const vitestOxcConfig = { tsconfig: false } as never
const windowsTestWorkerOptions = process.platform === 'win32' ? { maxWorkers: 4 } : {}

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  },
  // Why: the app tsconfig intentionally excludes tests; Vite 8's OXC transform
  // otherwise fails before Vitest can run the test modules.
  oxc: vitestOxcConfig,
  test: {
    // Why: match the root suite's Windows worker cap so large hosts do not overwhelm transforms.
    ...windowsTestWorkerOptions,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    onConsoleLog: (log) => !log.includes('react-test-renderer is deprecated'),
    // .tsx too: component tests exist (react-test-renderer + mocked react-native) and were
    // silently never collected, so render-level regressions shipped untested.
    // scripts/ too: the CI guards under it (the RPC recording pin) had no runnable test home,
    // and a test vitest never collects is not a gate.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.ts',
      'scripts/**/*.test.mjs'
    ]
  }
})

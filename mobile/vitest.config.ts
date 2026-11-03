import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const vitestOxcConfig = { tsconfig: false } as never
const windowsTestWorkerOptions = process.platform === 'win32' ? { maxWorkers: 4 } : {}

export default defineConfig({
  root: import.meta.dirname,
  // Tests are excluded from the app tsconfig; disable that config for OXC so test modules still transform.
  oxc: vitestOxcConfig,
  resolve: {
    // A faithful Node stand-in for the native module, rather than a mock in every test that reaches it.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'expo-crypto': fileURLToPath(
        new URL('./src/test-support/expo-crypto-node.ts', import.meta.url)
      )
    }
  },
  test: {
    ...windowsTestWorkerOptions,
    pool: 'threads',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    onConsoleLog: (log) => !log.includes('react-test-renderer is deprecated'),
    // Collect component and script tests too so render regressions and CI tooling are covered.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.ts',
      'scripts/**/*.test.mjs'
    ]
  }
})

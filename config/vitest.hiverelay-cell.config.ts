import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/e2e/hiverelay/hive-account-relay-private-cell.integration.test.ts'],
    fileParallelism: false,
    retry: 0
  }
})

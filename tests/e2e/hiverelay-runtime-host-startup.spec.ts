import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

test.use({
  dismissOnboarding: false,
  seedTestRepo: false,
  orcaAppExtraEnv: { HIVE_RELAY_V2_HOST_ENABLED: '1', HIVE_RELAY_REGION: 'cn-east' }
})

test('Desktop Runtime starts with Host enabled and no paired device', async ({ electronApp }) => {
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const execute = promisify(execFile)
  await expect
    .poll(
      async () => {
        try {
          const { stdout } = await execute(
            process.execPath,
            [join(process.cwd(), 'out/cli/index.js'), 'status', '--json'],
            {
              env: { ...process.env, ORCA_USER_DATA: userData },
              windowsHide: true,
              timeout: 10_000
            }
          )
          const status = JSON.parse(stdout)
          return status.result?.runtime?.reachable === true
        } catch {
          return false
        }
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  expect(await electronApp.evaluate(({ app }) => app.commandLine.hasSwitch('serve'))).toBe(false)
})

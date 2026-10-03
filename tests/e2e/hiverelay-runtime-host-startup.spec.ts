import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

test.use({
  dismissOnboarding: false,
  seedTestRepo: false
})

test('Desktop Runtime starts its Host without flags or paired devices', async ({ electronApp }) => {
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

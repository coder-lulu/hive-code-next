import { expect, it } from 'vitest'
import { buildWindowsDevLauncher } from './cli-dev-launcher'

it('clears stale inherited Crashpad registration before launching Electron Node CLI', () => {
  const script = buildWindowsDevLauncher(
    'C:/HiveCode/electron.exe',
    'C:/HiveCode/index.js',
    'C:/data'
  )
  expect(script.indexOf('set CHROME_CRASHPAD_PIPE_NAME=')).toBeLessThan(
    script.indexOf('"%ELECTRON%" "%CLI%"')
  )
  expect(script).not.toContain('2>')
})

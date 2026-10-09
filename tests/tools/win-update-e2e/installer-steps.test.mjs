import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { locateInstalledExe, silentUninstall } from './installer-steps.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('./powershell-runner.mjs', () => ({ runCommandSync: vi.fn() }))
vi.mock('./platform-guard.mjs', () => ({ assertWin32: vi.fn() }))

const directories = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function directory() {
  const fixtureRoot = path.join(process.cwd(), 'logs', 'win-installer-step-tests')
  mkdirSync(fixtureRoot, { recursive: true })
  const value = mkdtempSync(path.join(fixtureRoot, 'install-'))
  directories.push(value)
  return value
}

describe('HiveCode packaged installer identity', () => {
  it('discovers the manifest executable in an explicit isolated installation', () => {
    const install = directory()
    const executable = path.join(install, 'HiveCode.exe')
    writeFileSync(executable, '')
    expect(locateInstalledExe(install)).toBe(executable)
  })

  it('does not mistake a neighboring Orca executable for the HiveCode install', () => {
    const install = directory()
    writeFileSync(path.join(install, 'Orca.exe'), '')
    expect(locateInstalledExe(install)).toBeNull()
    expect(silentUninstall(install)).toBe(false)
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('refuses the real default HiveCode install without explicit ownership', () => {
    const localAppData = directory()
    vi.stubEnv('LOCALAPPDATA', localAppData)
    const install = path.join(localAppData, 'Programs', 'HiveCode')
    mkdirSync(install, { recursive: true })
    writeFileSync(path.join(install, 'HiveCode.exe'), '')
    expect(() => silentUninstall(install)).toThrow(
      'Refusing to uninstall the default install location'
    )
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('targets only the isolated HiveCode uninstaller and executable', () => {
    const install = directory()
    writeFileSync(path.join(install, 'HiveCode.exe'), '')
    const uninstaller = path.join(install, 'Uninstall HiveCode.exe')
    writeFileSync(uninstaller, '')
    spawnSync.mockImplementation(() => {
      rmSync(path.join(install, 'HiveCode.exe'))
      return { status: 0 }
    })
    expect(silentUninstall(install)).toBe(true)
    expect(spawnSync).toHaveBeenCalledWith(uninstaller, ['/S', `_?=${install}`], {
      encoding: 'utf8'
    })
  })
})

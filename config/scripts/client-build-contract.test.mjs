import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { selectTargets, targets, validateVersions } from './client-build-contract.mjs'

const require = createRequire(import.meta.url)
const {
  configureBuildCommand,
  createYargs,
  normalizeOptions
} = require('electron-builder/out/builder')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory')
const { Platform, Arch } = require('electron-builder')
const electronBuilderConfig = require('../electron-builder.config.cjs')

function resolveMacTargets(args) {
  const options = normalizeOptions(configureBuildCommand(createYargs()).parseSync(args))
  expect([...options.targets.keys()]).toEqual([Platform.MAC])
  return computeArchToTargetNamesMap(
    options.targets.get(Platform.MAC),
    { platformSpecificBuildOptions: electronBuilderConfig.mac },
    Platform.MAC
  )
}

describe('client build targets', () => {
  it('selects native desktop plus Android without silently cross-compiling', () => {
    expect(selectTargets('all', 'win32', 'x64')).toEqual(['windows-x64', 'android'])
    expect(selectTargets('desktop', 'linux', 'arm64')).toEqual(['linux-arm64'])
    expect(selectTargets('linux', 'linux', 'arm64')).toEqual(['linux-arm64'])
    expect(() => selectTargets('linux', 'win32', 'x64')).toThrow('native build host')
    expect(selectTargets('desktop', 'darwin', 'arm64')).toEqual(['macos-arm64'])
    expect(() => selectTargets('linux-x64', 'win32', 'x64')).toThrow('native build host')
    expect(selectTargets('ios', 'darwin', 'arm64')).toEqual(['ios'])
    expect(selectTargets('all', 'darwin', 'x64')).toEqual(['macos-x64', 'android', 'ios'])
    expect(() => selectTargets('ios', 'linux', 'x64')).toThrow('native build host')
    expect(() => selectTargets('../../outside', 'linux', 'x64')).toThrow('Unsupported target')
  })
  it.each(['x64', 'arm64'])(
    'resolves the native macOS %s build to only its own DMG and ZIP targets',
    (arch) => {
      expect([...resolveMacTargets(targets[`macos-${arch}`].builder)]).toEqual([
        [Arch[arch], ['dmg', 'zip']]
      ])
    }
  )
  it('preserves the global dual-architecture release configuration', () => {
    expect(electronBuilderConfig.mac.target).toEqual([
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ])
    const resolved = resolveMacTargets(['--mac', '--x64'])
    expect(resolved.get(Arch.x64)).toEqual(['dmg', 'zip'])
    expect(resolved.get(Arch.arm64)).toEqual(['dmg', 'zip'])
  })
  it('rejects version and toolchain drift before compiling', () => {
    const pkg = {
      version: '1.5.0-beta.2',
      engines: { node: '24.18.0' },
      packageManager: 'pnpm@12.0.0+sha512.test',
      devDependencies: { electron: '43.6.0' }
    }
    const mobile = { version: pkg.version }
    const app = { expo: { version: pkg.version, android: { versionCode: 20 } } }
    const chain = { node: '24.18.0', pnpm: '12.0.0', electron: '43.6.0' }
    expect(() => validateVersions(pkg, mobile, app, chain)).not.toThrow()
    expect(() => validateVersions(pkg, { version: '1.0.0' }, app, chain)).toThrow('versions differ')
    expect(() => validateVersions(pkg, mobile, app, { ...chain, pnpm: '10.24.0' })).toThrow(
      'metadata'
    )
    expect(() =>
      validateVersions(pkg, mobile, { expo: { ...app.expo, android: { versionCode: 0 } } }, chain)
    ).toThrow('versionCode')
  })
})

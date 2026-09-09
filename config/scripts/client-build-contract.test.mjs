import { describe, it, expect } from 'vitest'
import { selectTargets, validateVersions } from './client-build-contract.mjs'

describe('client build targets', () => {
  it('selects native desktop plus Android without silently cross-compiling', () => {
    expect(selectTargets('all', 'win32', 'x64')).toEqual(['windows-x64', 'android'])
    expect(selectTargets('desktop', 'linux', 'arm64')).toEqual(['linux-arm64'])
    expect(selectTargets('linux', 'linux', 'arm64')).toEqual(['linux-arm64'])
    expect(() => selectTargets('linux', 'win32', 'x64')).toThrow('native build host')
    expect(selectTargets('desktop', 'darwin', 'arm64')).toEqual(['macos-arm64'])
    expect(() => selectTargets('linux-x64', 'win32', 'x64')).toThrow('native build host')
    expect(() => selectTargets('ios', 'darwin', 'arm64')).toThrow('Unsupported target')
    expect(() => selectTargets('../../outside', 'linux', 'x64')).toThrow('Unsupported target')
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

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, '../..')
const builderConfig = require('../electron-builder.config.cjs')
const packageJson = require('../../package.json')

function resourceTargets(platform) {
  return (builderConfig[platform].extraResources ?? [])
    .map((resource) => resource.to)
    .filter((target) => typeof target === 'string')
}

function resourceSources(platform) {
  return (builderConfig[platform].extraResources ?? [])
    .map((resource) => resource.from)
    .filter((source) => typeof source === 'string')
}

describe('HiveCode packaged CLI identity', () => {
  it('ships HiveCode as the canonical launcher on every desktop platform', () => {
    expect(resourceTargets('mac')).toContain('bin/hivecode')
    expect(resourceTargets('linux')).toContain('bin/hivecode')
    expect(resourceTargets('win')).toEqual(
      expect.arrayContaining(['bin/hivecode.cmd', 'bin/hivecode.exe'])
    )

    for (const relativePath of [
      'resources/darwin/bin/hivecode',
      'resources/linux/bin/hivecode',
      'resources/win32/bin/hivecode.cmd'
    ]) {
      expect(existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(true)
    }
  })

  it('keeps compatibility launchers without claiming GNOME Orca on Linux', () => {
    expect(resourceTargets('mac')).toEqual(expect.arrayContaining(['bin/orca', 'bin/orca-ide']))
    expect(resourceTargets('linux')).toContain('bin/orca-ide')
    expect(resourceTargets('linux')).not.toContain('bin/orca')
    expect(resourceTargets('win')).toEqual(
      expect.arrayContaining([
        'bin/orca.cmd',
        'bin/orca.exe',
        'bin/orca-ide.cmd',
        'bin/orca-ide.exe'
      ])
    )
  })

  it('keeps the platform-neutral npm bin map safe for Linux', () => {
    expect(packageJson.bin.hivecode).toBe('./out/cli/index.js')
    expect(packageJson.bin['orca-ide']).toBe('./out/cli/index.js')
    expect(packageJson.bin).not.toHaveProperty('orca')
  })

  it('maps the audited native Windows launcher to all three public command names', () => {
    const windowsNativeMappings = (builderConfig.win.extraResources ?? []).filter(
      (resource) => resource.from === 'native/windows-cli-launcher/.build/orca.exe'
    )
    expect(windowsNativeMappings.map((resource) => resource.to)).toEqual([
      'bin/hivecode.exe',
      'bin/orca.exe',
      'bin/orca-ide.exe'
    ])
    expect(resourceSources('win')).toEqual(
      expect.arrayContaining([
        'resources/win32/bin/hivecode.cmd',
        'resources/win32/bin/orca.cmd',
        'resources/win32/bin/orca-ide.cmd'
      ])
    )
  })

  it('registers only hivecode and orca-ide from Linux root packages', () => {
    const afterInstall = readFileSync(
      path.join(repoRoot, 'resources/linux/packaging/after-install.sh'),
      'utf8'
    )
    const afterRemove = readFileSync(
      path.join(repoRoot, 'resources/linux/packaging/after-remove.sh'),
      'utf8'
    )

    expect(afterInstall).toContain('link="/usr/bin/$name"')
    expect(afterInstall).toContain('install_link hivecode "$hivecode_shim"')
    expect(afterInstall).toContain('install_link orca-ide "$orca_ide_shim"')
    expect(afterInstall).not.toMatch(/install_link orca\s/)

    expect(afterRemove).toContain('/usr/bin/hivecode')
    expect(afterRemove).toContain('/usr/bin/orca-ide')
    expect(afterRemove).not.toMatch(/\s\/usr\/bin\/orca(?:\s|;|$)/)
  })
})

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const { createManagedPiPackResource } = require('../managed-pi-pack-resources.cjs')
require('app-builder-lib')
const { WinPackager } = require('app-builder-lib/out/winPackager.js')

describe('Pack desktop resource and signing contract', () => {
  it.each([
    ['win', 'win32'],
    ['mac', 'darwin'],
    ['linux', 'linux']
  ])('maps a complete Pack for %s', (key, platform) => {
    const mapping = config[key].extraResources.filter((item) => item.to.startsWith('managed-pi/'))
    expect(mapping).toEqual([createManagedPiPackResource(platform)])
    expect(mapping[0].filter).toHaveLength(8)
    expect(mapping[0].filter).not.toContain('node_modules')
    expect(mapping[0].filter).not.toContain('build-trust.json')
  })

  it.each(['x64', 'arm64'])(
    'preserves only Pack Node bytes during Windows signing: %s',
    (architecture) => {
      const packager = { platformSpecificBuildOptions: config.win }
      for (const separator of ['/', '\\']) {
        const path = ['C:', 'resources', 'managed-pi', `win32-${architecture}`, 'node.exe'].join(
          separator
        )
        expect(WinPackager.prototype.shouldSignFile.call(packager, path)).toBe(false)
        expect(
          WinPackager.prototype.shouldSignFile.call(
            packager,
            ['C:', 'resources', 'other', 'node.exe'].join(separator)
          )
        ).toBe(true)
      }
      expect(WinPackager.prototype.shouldSignFile.call(packager, 'HiveCode.exe')).toBe(true)
      expect(WinPackager.prototype.shouldSignFile.call(packager, 'hive.exe')).toBe(true)
    }
  )

  it('preserves the macOS Pack Node signature with a bounded ignore rule', () => {
    const rules = config.mac.signIgnore.map((pattern) => new RegExp(pattern))
    expect(
      rules.some((rule) =>
        rule.test('/HiveCode.app/Contents/Resources/managed-pi/darwin-arm64/node')
      )
    ).toBe(true)
    expect(
      rules.some((rule) => rule.test('/HiveCode.app/Contents/Resources/managed-pi/darwin-x64/node'))
    ).toBe(true)
    expect(rules.some((rule) => rule.test('/HiveCode.app/Contents/MacOS/HiveCode'))).toBe(false)
    expect(rules.some((rule) => rule.test('/HiveCode.app/Contents/Resources/other/node'))).toBe(
      false
    )
  })

  it('gates copied files again after signing', () => {
    expect(typeof config.afterSign).toBe('function')
    expect(() => createManagedPiPackResource('freebsd')).toThrow('Unsupported Pack platform')
  })
})

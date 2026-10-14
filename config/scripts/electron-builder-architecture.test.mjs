import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeMobileWebBundleFixtureTree } from './mobile-web-bundle-fixture-tree.mjs'
const require = createRequire(import.meta.url)
const REPO_ROOT = join(import.meta.dirname, '..', '..')
const electronBuilderConfig = require('../electron-builder.config.cjs')

describe('arch-aware packaging guard', () => {
  // electron-builder Arch enum: ia32=0, x64=1, armv7l=2, arm64=3.
  const HOST_ARCH = process.arch === 'arm64' ? 3 : 1
  const OTHER_ARCH = process.arch === 'arm64' ? 1 : 3
  const OTHER_ARCH_NAME = process.arch === 'arm64' ? 'x64' : 'arm64'
  const SHERPA_PLATFORM = process.platform === 'win32' ? 'win' : process.platform
  const otherSherpa = `sherpa-onnx-${SHERPA_PLATFORM}-${OTHER_ARCH_NAME}`

  // beforePack also hash-verifies the mobile web bundle, which the unit-test job never builds.
  // Point it at a real bundle built into a temp dir: these tests are about the native-variant
  // guard, and the bundle guard has its own suite.
  let scratch
  let bundleDir
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'orca-electron-builder-guard-'))
    bundleDir = join(scratch, 'mobile-web')
    await writeMobileWebBundleFixtureTree({ outDir: bundleDir })
  })
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true })
  })

  const packHost = (arch) =>
    electronBuilderConfig.beforePack(
      { electronPlatformName: process.platform, arch },
      bundleDir,
      () => undefined
    )

  it('allows packaging the host platform and architecture', () => {
    expect(() => packHost(HOST_ARCH)).not.toThrow()
  })

  it('requires the other architecture natives to be installed', () => {
    const otherSherpaInstalled = existsSync(
      join(REPO_ROOT, 'node_modules', otherSherpa, 'package.json')
    )
    const otherSherpaExpected = Object.hasOwn(
      require('../../package.json').optionalDependencies,
      otherSherpa
    )
    if (otherSherpaExpected && !otherSherpaInstalled) {
      expect(() => packHost(OTHER_ARCH)).toThrow(otherSherpa)
      expect(() => packHost(OTHER_ARCH)).toThrow('pnpm install:release')
      expect(() => packHost(HOST_ARCH)).not.toThrow()
    } else {
      const watcher = `@parcel/watcher-${process.platform}-${OTHER_ARCH_NAME}${process.platform === 'linux' ? '-glibc' : ''}`
      if (!existsSync(join(REPO_ROOT, 'node_modules', watcher, 'package.json'))) {
        expect(() => packHost(OTHER_ARCH)).toThrow(watcher)
        expect(() => packHost(OTHER_ARCH)).toThrow('pnpm install:release')
      } else {
        expect(() => packHost(OTHER_ARCH)).not.toThrow()
      }
    }
  })

  it('requires installed Windows addons for Windows packaging', () => {
    const windowsAddon = electronBuilderConfig.win.extraResources.some(
      (resource) => resource.to === join('node_modules', '@vscode', 'windows-process-tree')
    )
    const packWindows = () =>
      electronBuilderConfig.beforePack({ electronPlatformName: 'win32', arch: 1 }, bundleDir)
    if (process.platform === 'win32' || windowsAddon) {
      expect(packWindows).not.toThrow()
    } else {
      expect(packWindows).toThrow('@vscode/windows-process-tree')
      expect(packWindows).toThrow('Windows packaging requires a Windows host')
    }
  })
})

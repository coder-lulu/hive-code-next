import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createPackagedRuntimeNodeModuleResources,
  findAsarEntry,
  prunePackagedNodePty,
  prunePackagedParcelWatcher,
  prunePackagedSherpaOnnx,
  prunePackagedRuntimeTypeAndSourceMapArtifacts,
  prunePackagedZodSources,
  verifyPackagedMainRuntimeDeps
} = require('../packaged-runtime-node-modules.cjs')

describe('electron-builder config', () => {
  it('verifies packaged main runtime deps from Windows-style asar entries', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-runtime-deps-'))
    try {
      await writeFile(join(resourcesDir, 'app.asar'), '', 'utf8')
      await mkdir(join(resourcesDir, 'node_modules', 'yaml'), { recursive: true })
      await mkdir(join(resourcesDir, 'node_modules', 'zod'), { recursive: true })

      const sources = new Map([
        ['out\\main\\index.js', 'const z = require("zod")'],
        ['out\\main\\agent-hooks\\managed-agent-hook-controls.js', 'const YAML = require("yaml")']
      ])
      const asar = {
        listPackage: () => [...sources.keys()].map((entry) => `\\${entry}`),
        extractFile: (_asarPath, internalPath) => Buffer.from(sources.get(internalPath), 'utf8')
      }

      expect(() => verifyPackagedMainRuntimeDeps(resourcesDir, asar)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('normalizes host-specific asar entry separators', () => {
    expect(findAsarEntry(['\\out\\main\\index.js'], 'out/main/index.js')).toBe(
      '\\out\\main\\index.js'
    )
    expect(findAsarEntry(['/out/main/index.js'], 'out/main/index.js')).toBe('/out/main/index.js')
  })

  it('prunes non-target node-pty architecture outputs from packaged runtime resources', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-node-pty-prune-'))
    try {
      const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
      const prebuildsDir = join(nodePtyDir, 'prebuilds')
      const binDir = join(nodePtyDir, 'bin')
      await mkdir(join(prebuildsDir, 'darwin-arm64'), { recursive: true })
      await mkdir(join(prebuildsDir, 'darwin-x64'), { recursive: true })
      await mkdir(join(prebuildsDir, 'linux-x64'), { recursive: true })
      await mkdir(join(prebuildsDir, 'win32-x64'), { recursive: true })
      await mkdir(join(binDir, 'darwin-arm64-148'), { recursive: true })
      await mkdir(join(binDir, 'darwin-x64-148'), { recursive: true })
      await mkdir(join(nodePtyDir, 'third_party', 'conpty'), {
        recursive: true
      })
      await mkdir(join(nodePtyDir, 'deps', 'winpty'), { recursive: true })

      prunePackagedNodePty(resourcesDir, 'darwin', 3)

      await expect(readdir(prebuildsDir)).resolves.toEqual(['darwin-arm64'])
      await expect(readdir(binDir)).resolves.toEqual(['darwin-arm64-148'])
      await expect(readdir(join(nodePtyDir, 'third_party'))).resolves.toEqual([])
      await expect(readdir(join(nodePtyDir, 'deps'))).resolves.toEqual([])
      expect(() => prunePackagedNodePty(resourcesDir, 'darwin', 4)).toThrow(
        'Unsupported packaged runtime architecture: 4'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('copies the Windows node-pty ConPTY runtime beside the rebuilt addon', async () => {
    for (const [arch, electronArch] of [
      ['x64', 1],
      ['arm64', 3]
    ]) {
      const resourcesDir = await mkdtemp(join(tmpdir(), `orca-node-pty-conpty-${arch}-`))
      try {
        const nodePtyDir = join(resourcesDir, 'node_modules', 'node-pty')
        const releaseDir = join(nodePtyDir, 'build', 'Release')
        const conptyRoot = join(nodePtyDir, 'third_party', 'conpty', '0.1.0')
        await mkdir(releaseDir, { recursive: true })
        await writeFile(join(releaseDir, 'conpty.node'), 'native addon placeholder', 'utf8')
        for (const sourceArch of ['x64', 'arm64']) {
          const sourceDir = join(conptyRoot, `win10-${sourceArch}`)
          await mkdir(sourceDir, { recursive: true })
          await writeFile(join(sourceDir, 'conpty.dll'), `dll payload ${sourceArch}`, 'utf8')
          await writeFile(
            join(sourceDir, 'OpenConsole.exe'),
            `console payload ${sourceArch}`,
            'utf8'
          )
        }

        prunePackagedNodePty(resourcesDir, 'win32', electronArch)

        await expect(readFile(join(releaseDir, 'conpty', 'conpty.dll'), 'utf8')).resolves.toBe(
          `dll payload ${arch}`
        )
        await expect(readFile(join(releaseDir, 'conpty', 'OpenConsole.exe'), 'utf8')).resolves.toBe(
          `console payload ${arch}`
        )
      } finally {
        await rm(resourcesDir, { recursive: true, force: true })
      }
    }
  })

  it('includes external main dependencies in the packaged runtime closure', () => {
    // Why: the main process imports '@parcel/watcher' for filesystem change
    // events; if it is absent from the packaged closure the serve host silently
    // stops propagating file changes to clients (regression guard for #4851).
    const packaged = createPackagedRuntimeNodeModuleResources()
    const packagedTargets = packaged.map((resource) => resource.to)
    expect(packagedTargets).toContain(join('node_modules', '@parcel', 'watcher'))
    expect(
      packagedTargets.some((target) =>
        target.startsWith(join('node_modules', '@parcel', 'watcher-'))
      )
    ).toBe(true)
    expect(packagedTargets).toContain(join('node_modules', 'proper-lockfile'))
  })

  it('prunes non-target @parcel/watcher architecture subpackages', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-parcel-watcher-prune-'))
    try {
      const parcelDir = join(resourcesDir, 'node_modules', '@parcel')
      await mkdir(join(parcelDir, 'watcher'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-darwin-arm64'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-darwin-x64'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-linux-x64-glibc'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-linux-arm64-glibc'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-win32-x64'), { recursive: true })

      prunePackagedParcelWatcher(resourcesDir, 'linux', 'arm64')

      await expect(readdir(parcelDir).then((entries) => entries.sort())).resolves.toEqual([
        'watcher',
        'watcher-linux-arm64-glibc'
      ])
      expect(() => prunePackagedParcelWatcher(resourcesDir, 'linux', 'universal')).toThrow(
        'Unsupported packaged runtime architecture: universal'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('leaves unrelated @parcel/* runtime deps untouched when pruning the watcher', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-parcel-watcher-prune-unrelated-'))
    try {
      const parcelDir = join(resourcesDir, 'node_modules', '@parcel')
      await mkdir(join(parcelDir, 'watcher'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-darwin-arm64'), { recursive: true })
      await mkdir(join(parcelDir, 'watcher-linux-x64-glibc'), { recursive: true })
      // A hypothetical future @parcel/* runtime dep that is NOT a watcher subpackage.
      await mkdir(join(parcelDir, 'transformer-js'), { recursive: true })

      prunePackagedParcelWatcher(resourcesDir, 'linux', 1)

      await expect(readdir(parcelDir).then((entries) => entries.sort())).resolves.toEqual([
        'transformer-js',
        'watcher',
        'watcher-linux-x64-glibc'
      ])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('prunes type declaration artifacts from packaged runtime node_modules', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-runtime-type-prune-'))
    try {
      const packageDir = join(resourcesDir, 'node_modules', 'example-package')
      await mkdir(join(packageDir, 'dist'), { recursive: true })
      await writeFile(join(packageDir, 'dist', 'index.cjs'), 'module.exports = {}', 'utf8')
      await writeFile(join(packageDir, 'dist', 'index.d.ts'), 'export type Value = string', 'utf8')
      await writeFile(join(packageDir, 'dist', 'index.d.cts'), 'export type Value = string', 'utf8')
      await writeFile(join(packageDir, 'dist', 'index.d.mts'), 'export type Value = string', 'utf8')
      await writeFile(join(packageDir, 'dist', 'index.d.cts.map'), '{}', 'utf8')
      await writeFile(join(packageDir, 'dist', 'index.d.mts.map'), '{}', 'utf8')

      prunePackagedRuntimeTypeAndSourceMapArtifacts(resourcesDir)

      await expect(readdir(join(packageDir, 'dist'))).resolves.toEqual(['index.cjs'])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('prunes duplicate darwin sherpa-onnx runtime dylib aliases', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-sherpa-prune-'))
    try {
      const packageDir = join(resourcesDir, 'node_modules', 'sherpa-onnx-darwin-arm64')
      await mkdir(packageDir, { recursive: true })
      await writeFile(join(packageDir, 'sherpa-onnx.node'), '', 'utf8')
      await writeFile(join(packageDir, 'libonnxruntime.1.23.2.dylib'), '', 'utf8')
      await writeFile(join(packageDir, 'libonnxruntime.dylib'), '', 'utf8')

      prunePackagedSherpaOnnx(resourcesDir, 'darwin')

      await expect(readdir(packageDir).then((entries) => entries.sort())).resolves.toEqual([
        'libonnxruntime.1.23.2.dylib',
        'sherpa-onnx.node'
      ])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('prunes zod TypeScript sources from packaged runtime resources', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-zod-prune-'))
    try {
      const packageDir = join(resourcesDir, 'node_modules', 'zod')
      await mkdir(join(packageDir, 'src'), { recursive: true })
      await writeFile(join(packageDir, 'index.cjs'), 'module.exports = {}', 'utf8')
      await writeFile(join(packageDir, 'src', 'index.ts'), 'export const value = true', 'utf8')

      prunePackagedZodSources(resourcesDir)

      await expect(readdir(packageDir)).resolves.toEqual(['index.cjs'])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})

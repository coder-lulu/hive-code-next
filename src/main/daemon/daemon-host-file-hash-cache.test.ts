import type * as NodeFs from 'node:fs'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAppEnvironment } from '../../shared/app-environment'
import { fileStatSignature } from '../file-stat-signature'
import { hashDaemonHostFile } from './daemon-host-file-hash-cache'
import { readDaemonHostBuildMarker } from './daemon-host-build-inventory'
import { buildInstallFixture } from './daemon-host-relocation.test-fixture'
import { getRelocatedDaemonHost, materializeRelocatedDaemonHost } from './daemon-host-relocation'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    cpSync: vi.fn(actual.cpSync),
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(actual.statSync)
  }
})

function codeReads(): unknown[] {
  return vi
    .mocked(readFileSync)
    .mock.calls.map(([path]) => path)
    .filter((path) => typeof path === 'string' && path.endsWith('.js'))
}

const originalPlatform = process.platform
const originalExecPath = process.execPath
const originalResourcesPath = process.resourcesPath
const originalLocalAppData = process.env.LOCALAPPDATA
const chunkRel = join('resources', 'app.asar.unpacked', 'out', 'main', 'chunks', 'a.js')
let tempDir: string
let installDir: string

function setProcessProp(key: string, value: unknown): void {
  Object.defineProperty(process, key, { value, configurable: true, writable: true })
}

function materializedRoot(): string {
  const host = materializeRelocatedDaemonHost()
  if (!host) {
    throw new Error('fixture host was not materialized')
  }
  return dirname(host.execPath)
}

const PINNED_MTIME_SECONDS = 1_700_000_000

// Whole-second mtime so restoring it is exact; only identity/ctime can then reveal the edit.
function pinMtime(path: string): void {
  utimesSync(path, PINNED_MTIME_SECONDS, PINNED_MTIME_SECONDS)
}

function rewriteKeepingSizeAndMtime(path: string, contents: string): void {
  const before = statSync(path)
  expect(contents.length).toBe(before.size)
  writeFileSync(path, contents)
  pinMtime(path)
  expect(statSync(path).mtimeMs).toBe(before.mtimeMs)
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  vi.mocked(statSync).mockImplementation(actual.statSync)
  vi.mocked(cpSync).mockClear()
  vi.mocked(readFileSync).mockClear()
  tempDir = mkdtempSync(join(os.tmpdir(), 'daemon-host-hash-cache-'))
  installDir = join(tempDir, 'app')
  buildInstallFixture(installDir)
  process.env.LOCALAPPDATA = join(tempDir, 'localAppData')
  setAppEnvironment({
    getPath: () => join(tempDir, 'userData'),
    getAppPath: () => join(installDir, 'resources', 'app.asar'),
    getVersion: () => '9.9.9',
    isPackaged: () => true,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
  setProcessProp('platform', 'win32')
  setProcessProp('execPath', join(installDir, 'Orca.exe'))
  setProcessProp('resourcesPath', join(installDir, 'resources'))
})

afterEach(() => {
  setProcessProp('platform', originalPlatform)
  setProcessProp('execPath', originalExecPath)
  setProcessProp('resourcesPath', originalResourcesPath)
  if (originalLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA
  } else {
    process.env.LOCALAPPDATA = originalLocalAppData
  }
  rmSync(tempDir, { recursive: true, force: true })
})

describe('daemon-host code integrity', () => {
  it('revalidates warm code with bounded reads and no runtime reads or mirror copy', () => {
    const root = materializedRoot()
    const marker = readDaemonHostBuildMarker(root)!
    const codePaths = marker.files
      .filter((file) => file.path.endsWith('.js'))
      .flatMap((file) => [join(installDir, file.path), join(root, file.path)])
    expect(codePaths.length).toBeGreaterThan(0)
    vi.mocked(readFileSync).mockClear()
    vi.mocked(cpSync).mockClear()

    expect(getRelocatedDaemonHost()?.execPath).toBe(join(root, 'Orca.exe'))
    expect(materializeRelocatedDaemonHost()?.execPath).toBe(join(root, 'Orca.exe'))
    expect(codeReads().sort()).toEqual(codePaths.flatMap((path) => [path, path]).sort())
    const codeBytes = codePaths.reduce((total, path) => total + statSync(path).size, 0)
    expect(codeBytes * 2).toBeLessThan(1024)
    expect(vi.mocked(cpSync)).not.toHaveBeenCalled()
    const binaryReads = vi
      .mocked(readFileSync)
      .mock.calls.filter(
        ([path]) => typeof path === 'string' && /\.(?:exe|dll|node|bin|dat)$/u.test(path)
      )
    expect(binaryReads).toEqual([])
  })

  it.each(['source', 'mirror'] as const)(
    'rejects a %s code edit even when its complete stat signature is unchanged',
    async (side) => {
      const root = materializedRoot()
      const path = join(side === 'source' ? installDir : root, chunkRel)
      const actual = await vi.importActual<typeof NodeFs>('node:fs')
      pinMtime(path)
      const frozen = actual.statSync(path, { bigint: true })
      vi.mocked(statSync).mockImplementation(((
        filePath: NodeFs.PathLike,
        options?: { bigint?: boolean }
      ) => {
        // Keep real missing-file errors and all other paths; only this file's identity is frozen.
        const observed = actual.statSync(filePath, options)
        return filePath === path && options?.bigint ? frozen : observed
      }) as typeof statSync)
      expect(getRelocatedDaemonHost()).not.toBeNull()
      const before = hashDaemonHostFile(path)
      rewriteKeepingSizeAndMtime(path, 'chunX')
      expect(statSync(path, { bigint: true })).toBe(frozen)

      expect(hashDaemonHostFile(path)).not.toBe(before)
      expect(getRelocatedDaemonHost()).toBeNull()
    }
  )

  it('detects a same-size source edit that restores mtime', () => {
    pinMtime(join(installDir, chunkRel))
    const root = materializedRoot()
    rewriteKeepingSizeAndMtime(join(installDir, chunkRel), 'chunX')

    expect(getRelocatedDaemonHost()).toBeNull()
    expect(codeReads()).toContain(join(installDir, chunkRel))
    const rebuilt = materializedRoot()
    expect(rebuilt).not.toBe(root)
    expect(readFileSync(join(rebuilt, chunkRel), 'utf8')).toBe('chunX')
  })

  it('detects a same-size mirror edit that restores mtime', () => {
    const root = materializedRoot()
    pinMtime(join(root, chunkRel))
    expect(getRelocatedDaemonHost()).not.toBeNull()
    rewriteKeepingSizeAndMtime(join(root, chunkRel), 'chunX')

    expect(getRelocatedDaemonHost()).toBeNull()
  })

  it('detects a mirror file deleted after it was cached', () => {
    const root = materializedRoot()
    getRelocatedDaemonHost()
    rmSync(join(root, chunkRel))

    expect(getRelocatedDaemonHost()).toBeNull()
  })

  it('keeps the observed build when the source disappears after caching', () => {
    const root = materializedRoot()
    rmSync(installDir, { recursive: true, force: true })

    expect(getRelocatedDaemonHost()?.execPath).toBe(join(root, 'Orca.exe'))
    expect(() => hashDaemonHostFile(join(installDir, chunkRel))).toThrow()
  })

  it('keeps file ids and timestamps that a float stat would collapse distinct', () => {
    const base = {
      dev: 1n,
      ino: 9_007_199_254_740_993n,
      size: 5n,
      mtimeNs: 1_700_000_000_000_000_001n,
      ctimeNs: 1_700_000_000_000_000_001n
    }
    const signature = fileStatSignature(base)

    expect(fileStatSignature({ ...base, ino: base.ino + 1n })).not.toBe(signature)
    expect(fileStatSignature({ ...base, mtimeNs: base.mtimeNs + 1n })).not.toBe(signature)
    expect(fileStatSignature({ ...base, ctimeNs: base.ctimeNs + 1n })).not.toBe(signature)
  })
})

import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveHiveAgentTextPack } from '../native-chat/hive-agent-text-pack'
import { loadManagedPiTextPack } from './managed-pi-pack-loader'
import {
  bundledNodeProbeFixture,
  installedPackFixture
} from './managed-pi-pack-loader.test-fixture'

vi.mock('../../shared/child-process/run-process', () => ({ runProcess: vi.fn() }))

const temporaryRoot = resolve('logs/ai-pack-loader-20260914/tmp')
const roles = ['node', 'runner', 'package', 'lock', 'sbom', 'license', 'notice'] as const
let ownedRoot: string
let fixture: Awaited<ReturnType<typeof installedPackFixture>>

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true })
  ownedRoot = await mkdtemp(join(temporaryRoot, 'pack-'))
  fixture = await installedPackFixture(join(ownedRoot, '受管 Pack with spaces'))
  vi.mocked(runProcess).mockReset().mockResolvedValue(bundledNodeProbeFixture())
})
afterEach(async () => {
  const owned = relative(temporaryRoot, ownedRoot)
  if (owned && !owned.startsWith('..') && !isAbsolute(owned)) {
    await rm(ownedRoot, { recursive: true, force: true })
  }
})

const unavailable = /^hive_agent_pack_unavailable$/
const load = () => loadManagedPiTextPack(fixture.trust)
const file = (role: (typeof roles)[number]) =>
  join(fixture.trust.rootDirectory, fixture.names[role])
async function corrupt(path: string) {
  const content = await readFile(path)
  content[0] ^= 1
  await writeFile(path, content)
}

describe('verified managed Pi Pack loader', () => {
  it('uses an external digest, absolute verified Node and isolated bounded probe; reuses P2 admission', async () => {
    const pack = await load()
    const admission = resolveHiveAgentTextPack(pack.readPack, 'personal', 'CHAT_COMPLETIONS')
    expect(admission.binding.packRevision).toBe(fixture.trust.indexSha256)
    expect(admission.assertCurrent).not.toThrow()
    expect(pack.getLaunchFiles()).toEqual({ node: file('node'), runner: file('runner') })
    expect(Object.isFrozen(pack)).toBe(true)
    expect(Object.isFrozen(pack.getLaunchFiles())).toBe(true)
    const specification = vi.mocked(runProcess).mock.calls[0][0]
    expect(specification).toMatchObject({
      program: file('node'),
      cwd: fixture.trust.rootDirectory,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      terminationBarrier: true
    })
    expect(specification.args?.[0]).toBe('-p')
    expect(specification.env?.ORCA_BACKGROUND_LAUNCH).toBe('1')
    expect(specification.env?.PATH).toBe(join(fixture.trust.rootDirectory, 'bin'))
    expect(specification.env).not.toHaveProperty('NODE_OPTIONS')
    expect(specification.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(specification.env).not.toHaveProperty('HTTPS_PROXY')
    expect(runProcess).toHaveBeenCalledTimes(1)
  })

  it('captures trust input before asynchronous work', async () => {
    const trustedDigest = fixture.trust.indexSha256
    const pending = load()
    fixture.trust.indexSha256 = '0'.repeat(64)
    fixture.trust.rootDirectory = join(ownedRoot, 'untrusted replacement')
    const pack = await pending
    expect(
      resolveHiveAgentTextPack(pack.readPack, 'personal', 'RESPONSES').binding.packRevision
    ).toBe(trustedDigest)
  })

  it('returns independent manifest snapshots', async () => {
    const pack = await load()
    const snapshot = pack.readPack()!
    ;(snapshot.manifest as { nodeVersion: string }).nodeVersion = '0.0.0'
    expect(
      resolveHiveAgentTextPack(pack.readPack, 'personal', 'CHAT_COMPLETIONS').assertCurrent
    ).not.toThrow()
  })

  it.each(['relative', 'empty-digest', 'uppercase-digest', 'mismatched-digest'])(
    'rejects %s trust before executing Node',
    async (mode) => {
      if (mode === 'relative') {
        fixture.trust.rootDirectory = 'relative'
      }
      if (mode === 'empty-digest') {
        fixture.trust.indexSha256 = ''
      }
      if (mode === 'uppercase-digest') {
        fixture.trust.indexSha256 = fixture.trust.indexSha256.toUpperCase()
      }
      if (mode === 'mismatched-digest') {
        fixture.trust.indexSha256 = '0'.repeat(64)
      }
      await expect(load()).rejects.toThrow(unavailable)
      expect(runProcess).not.toHaveBeenCalled()
    }
  )

  it.each([
    'extra-field',
    'extra-role',
    'traversal-role',
    'zero-size',
    'node-limit',
    'wrong-hash',
    'self-revision',
    'no-profile'
  ])('rejects %s index', async (mode) => {
    const index = fixture.index as unknown as Record<string, unknown>
    if (mode === 'extra-field') {
      index.untrusted = true
    }
    if (mode === 'extra-role') {
      Object.assign(fixture.index.artifacts, { extra: fixture.index.artifacts.runner })
    }
    if (mode === 'traversal-role') {
      Object.assign(fixture.index.artifacts, { '../runner': fixture.index.artifacts.runner })
    }
    if (mode === 'zero-size') {
      fixture.index.artifacts.node.size = 0
    }
    if (mode === 'node-limit') {
      fixture.index.artifacts.node.size = 128 * 1024 * 1024 + 1
    }
    if (mode === 'wrong-hash') {
      fixture.index.artifacts.node.sha256 = 'invalid'
    }
    if (mode === 'self-revision') {
      Object.assign(fixture.index.manifest, { packRevision: 'a'.repeat(64) })
    }
    if (mode === 'no-profile') {
      fixture.index.manifest.profiles = []
    }
    await fixture.saveIndex()
    await expect(load()).rejects.toThrow(unavailable)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each([
    'nodeVersion',
    'piCoreVersion',
    'piAiVersion',
    'sourceCommit',
    'platform',
    'architecture'
  ] as const)('rejects incompatible declared %s before probe', async (field) => {
    const manifest = fixture.index.manifest
    if (field === 'platform') {
      manifest.platform = process.platform === 'win32' ? 'linux' : 'win32'
    } else if (field === 'architecture') {
      manifest.architecture = process.arch === 'x64' ? 'arm64' : 'x64'
    } else if (field === 'sourceCommit') {
      manifest.sourceCommit = 'a'.repeat(40)
    } else {
      manifest[field] = '0.0.0'
    }
    await fixture.saveIndex()
    await expect(load()).rejects.toThrow(unavailable)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each(roles)('rejects same-size corruption of %s before probe', async (role) => {
    await corrupt(file(role))
    await expect(load()).rejects.toThrow(unavailable)
    expect(runProcess).not.toHaveBeenCalled()
  })
  it.each(roles)('requires the %s artifact', async (role) => {
    await rm(file(role))
    await expect(load()).rejects.toThrow(unavailable)
    expect(runProcess).not.toHaveBeenCalled()
  })
  it.each([
    'extra-file',
    'extra-directory',
    'missing-index',
    'invalid-json',
    'index-limit',
    'hardlink',
    'directory-artifact',
    'linked-root'
  ])('rejects %s without probe', async (mode) => {
    const root = fixture.trust.rootDirectory
    if (mode === 'extra-file') {
      await writeFile(join(root, 'extra'), 'unexpected')
    }
    if (mode === 'extra-directory') {
      await mkdir(join(root, 'node_modules'))
    }
    if (mode === 'missing-index') {
      await rm(join(root, 'pack-index.json'))
    }
    if (mode === 'invalid-json') {
      await writeFile(join(root, 'pack-index.json'), '{')
    }
    if (mode === 'index-limit') {
      await writeFile(join(root, 'pack-index.json'), 'x'.repeat(64 * 1024 + 1))
    }
    if (mode === 'hardlink') {
      await link(file('runner'), join(ownedRoot, 'outside-runner'))
    }
    if (mode === 'directory-artifact') {
      await rm(file('runner'))
      await mkdir(file('runner'))
    }
    if (mode === 'linked-root') {
      const alias = join(ownedRoot, 'linked-root')
      await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
      fixture.trust.rootDirectory = alias
    }
    await expect(load()).rejects.toThrow(unavailable)
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each([
    'exit',
    'signal',
    'timeout',
    'truncation',
    'stderr',
    'invalid-json',
    'wrong-node',
    'wrong-platform',
    'wrong-architecture',
    'extra-property',
    'spawn-rejection'
  ])('rejects %s probe outcome', async (mode) => {
    const probe = bundledNodeProbeFixture()
    if (mode === 'exit') {
      probe.code = 1
    }
    if (mode === 'signal') {
      Object.assign(probe, { signal: 'SIGTERM' })
    }
    if (mode === 'timeout') {
      probe.timedOut = true
    }
    if (mode === 'truncation') {
      Object.assign(probe, { outputTruncated: true })
    }
    if (mode === 'stderr') {
      probe.stderr = 'private diagnostics'
    }
    if (mode === 'invalid-json') {
      probe.stdout = 'private invalid response'
    }
    if (mode.startsWith('wrong-') || mode === 'extra-property') {
      const actual = JSON.parse(probe.stdout)
      if (mode === 'wrong-node') {
        actual.node = '0.0.0'
      }
      if (mode === 'wrong-platform') {
        actual.platform = 'other'
      }
      if (mode === 'wrong-architecture') {
        actual.architecture = 'other'
      }
      if (mode === 'extra-property') {
        actual.extra = true
      }
      probe.stdout = JSON.stringify(actual)
    }
    vi.mocked(runProcess).mockResolvedValue(probe)
    if (mode === 'spawn-rejection') {
      vi.mocked(runProcess).mockRejectedValue(new Error('private spawn diagnostics'))
    }
    await expect(load()).rejects.toThrow(unavailable)
  })

  it.each(roles)('rejects %s changes during the probe before publishing a source', async (role) => {
    vi.mocked(runProcess).mockImplementation(async () => {
      await corrupt(file(role))
      return bundledNodeProbeFixture()
    })
    await expect(load()).rejects.toThrow(unavailable)
  })
  it.each(roles)('permanently revokes %s changes at the existing P2 guard', async (role) => {
    const pack = await load()
    const admission = resolveHiveAgentTextPack(pack.readPack, 'personal', 'CHAT_COMPLETIONS')
    const original = await readFile(file(role))
    await corrupt(file(role))
    expect(admission.assertCurrent).toThrow(unavailable)
    await writeFile(file(role), original)
    expect(pack.readPack).toThrow(unavailable)
    expect(pack.getLaunchFiles).toThrow(unavailable)
    expect(runProcess).toHaveBeenCalledTimes(1)
  })

  it.each(['index', 'inventory', 'root-replacement', 'dispose'])(
    'revokes %s changes including retained snapshots',
    async (mode) => {
      const pack = await load()
      const snapshot = pack.readPack()!
      if (mode === 'index') {
        await corrupt(join(fixture.trust.rootDirectory, 'pack-index.json'))
      }
      if (mode === 'inventory') {
        await writeFile(join(fixture.trust.rootDirectory, 'extra'), 'late')
      }
      if (mode === 'root-replacement') {
        await rename(fixture.trust.rootDirectory, join(ownedRoot, 'previous-root'))
        await installedPackFixture(fixture.trust.rootDirectory)
      }
      if (mode === 'dispose') {
        pack.dispose()
      }
      expect(snapshot.assertCurrent).toThrow(unavailable)
      expect(pack.readPack).toThrow(unavailable)
      expect(pack.getLaunchFiles).toThrow(unavailable)
    }
  )
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import type * as NodeCrypto from 'node:crypto'
import { installAgentBinary } from './agent-binary-install'
import type { AgentInstallProvider } from '../../shared/agent-install-providers'
import type { AgentVersionResult } from '../../shared/agent-version-types'

const mocks = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  write: vi.fn(),
  download: vi.fn(),
  current: vi.fn(),
  uuid: vi.fn(),
  guard: vi.fn()
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  existsSync: mocks.exists,
  mkdirSync: mocks.mkdir,
  renameSync: mocks.rename,
  rmSync: mocks.remove,
  writeFileSync: mocks.write
}))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => 'C:\\Users\\tester'
}))
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeCrypto>()),
  randomUUID: mocks.uuid
}))
vi.mock('./agent-installer-download', () => ({ downloadAgentInstaller: mocks.download }))
vi.mock('./agent-version-service', () => ({ readAgentVersion: mocks.current }))
vi.mock('./agent-installation-identity', () => ({ assertReviewedAgentTarget: mocks.guard }))

const provider: Extract<AgentInstallProvider, { kind: 'binary' }> = {
  kind: 'binary',
  urls: { 'win32-x64': 'https://acli.atlassian.com/windows/latest/acli_windows_amd64/acli.exe' }
}
const command = 'C:\\tools\\acli.exe'
const candidate = 'C:\\tools\\.hive-candidate-acli.exe'
const backup = 'C:\\tools\\.hive-backup-backup-acli.exe'
const oldData = Buffer.from('existing verified executable')
const newData = Buffer.from('downloaded candidate executable')
const versions = { previousVersion: '1.0.0', expectedVersion: '2.0.0' }

function move(source: string, destination: string): void {
  const data = mocks.files.get(source)
  if (!data) {
    throw new Error(`Missing mock file: ${source}`)
  }
  mocks.files.set(destination, data)
  mocks.files.delete(source)
}

beforeEach(() => {
  mocks.files.clear()
  mocks.files.set(command, oldData)
  for (const mock of [
    mocks.exists,
    mocks.mkdir,
    mocks.rename,
    mocks.remove,
    mocks.write,
    mocks.download,
    mocks.current,
    mocks.uuid,
    mocks.guard
  ]) {
    mock.mockReset()
  }
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
  mocks.uuid.mockReturnValueOnce('candidate').mockReturnValueOnce('backup')
  mocks.download.mockResolvedValue(newData)
  mocks.current.mockResolvedValue({ status: 'ready', version: '2.0.0' })
  mocks.exists.mockImplementation((file: string) => mocks.files.has(file))
  mocks.rename.mockImplementation(move)
  mocks.remove.mockImplementation((file: string) => {
    mocks.files.delete(file)
  })
  mocks.write.mockImplementation((file: string, data: Buffer) => {
    mocks.files.set(file, data)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('verified binary replacement', () => {
  it('does not overwrite a target replaced while the candidate was downloading or being verified', async () => {
    mocks.current.mockImplementation(async () => {
      mocks.guard.mockImplementation(() => {
        throw new Error('upgrade-target-changed')
      })
      return { status: 'ready', version: '2.0.0' }
    })
    await expect(
      installAgentBinary(
        { agent: 'rovo', action: 'upgrade', expectedRealPath: command },
        provider,
        command,
        versions
      )
    ).rejects.toThrow('upgrade-target-changed')
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.files.get(command)).toEqual(oldData)
    expect(mocks.files.has(candidate)).toBe(false)
  })
  it.each([
    { status: 'error', version: null },
    { status: 'ready', version: null },
    { status: 'ready', version: '0.9.0' },
    { status: 'ready', version: '1.5.0' },
    { status: 'ready', version: '2.0.0-preview.1' }
  ] satisfies AgentVersionResult[])(
    'does not rename the active executable for a candidate that cannot satisfy version requirements',
    async (result) => {
      mocks.current.mockResolvedValue(result)
      await expect(
        installAgentBinary({ agent: 'rovo', action: 'upgrade' }, provider, command, versions)
      ).rejects.toThrow('install-verification-failed')
      expect(mocks.rename).not.toHaveBeenCalled()
      expect(mocks.files.get(command)).toEqual(oldData)
      expect(mocks.files.has(candidate)).toBe(false)
      expect(mocks.current).toHaveBeenCalledWith({ agent: 'rovo', commandOverride: candidate })
    }
  )

  it('keeps the original untouched while candidate verification is pending and replaces it only after success', async () => {
    let resolveVersion: (result: AgentVersionResult) => void = () => {}
    mocks.current.mockReturnValue(
      new Promise<AgentVersionResult>((resolve) => {
        resolveVersion = resolve
      })
    )
    const pending = installAgentBinary(
      { agent: 'rovo', action: 'upgrade' },
      provider,
      command,
      versions
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.current).toHaveBeenCalledTimes(1)
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.files.get(command)).toEqual(oldData)
    expect(mocks.files.get(candidate)).toEqual(newData)

    resolveVersion({ status: 'ready', version: '2.0.0' })
    await expect(pending).resolves.toEqual({ command, bin: 'C:\\tools' })
    expect(mocks.rename.mock.calls).toEqual([
      [command, backup],
      [candidate, command]
    ])
    expect(mocks.files.get(command)).toEqual(newData)
    expect(mocks.files.has(candidate)).toBe(false)
    expect(mocks.files.has(backup)).toBe(false)
    expect(mocks.download).toHaveBeenCalledWith(provider.urls['win32-x64'], 128 * 1024 * 1024)
    expect(mocks.write).toHaveBeenCalledWith(candidate, newData, { mode: 0o755, flag: 'wx' })
  })

  it('restores the original backup when candidate replacement rename fails', async () => {
    mocks.rename.mockImplementation((source: string, destination: string) => {
      if (source === candidate) {
        throw new Error('replacement rename failed')
      }
      move(source, destination)
    })
    await expect(
      installAgentBinary({ agent: 'rovo', action: 'upgrade' }, provider, command, versions)
    ).rejects.toThrow('replacement rename failed')
    expect(mocks.rename.mock.calls).toEqual([
      [command, backup],
      [candidate, command],
      [backup, command]
    ])
    expect(mocks.files.get(command)).toEqual(oldData)
    expect(mocks.files.has(candidate)).toBe(false)
    expect(mocks.files.has(backup)).toBe(false)
  })

  it('does not mutate or remove the original if creating its backup fails', async () => {
    mocks.rename.mockImplementation(() => {
      throw new Error('backup rename failed')
    })
    await expect(
      installAgentBinary({ agent: 'rovo', action: 'upgrade' }, provider, command, versions)
    ).rejects.toThrow('backup rename failed')
    expect(mocks.rename).toHaveBeenCalledTimes(1)
    expect(mocks.files.get(command)).toEqual(oldData)
    expect(mocks.remove.mock.calls.map(([file]) => file)).not.toContain(command)
  })

  it('rejects a different executable upgrade target without downloading or replacing it', async () => {
    await expect(
      installAgentBinary(
        { agent: 'rovo', action: 'upgrade' },
        provider,
        'C:\\tools\\other.exe',
        versions
      )
    ).rejects.toThrow('upgrade-provider-unavailable')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.rename).not.toHaveBeenCalled()
  })
})

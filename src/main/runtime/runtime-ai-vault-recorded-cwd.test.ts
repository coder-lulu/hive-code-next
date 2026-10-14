import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeAiVaultCommands } from './runtime-ai-vault-commands'
import { listAiVaultSessions } from '../ai-vault/cached-session-list'
import { stat } from 'node:fs/promises'
vi.mock('../ai-vault/cached-session-list', () => ({ listAiVaultSessions: vi.fn() }))
vi.mock('node:fs/promises', () => ({ stat: vi.fn() }))
const args = {
  agent: 'codex' as const,
  sessionId: 's1',
  filePath: '/owned/sessions/s1.jsonl',
  codexHome: '/owned',
  executionHostId: 'local' as const,
  checkRecordedCwd: true
}
const row = { ...args, cwd: '/deleted/worktree' }
const prepare = vi.fn(async () => ({ useRealCodexHome: false }))
const commands = new RuntimeAiVaultCommands(() => prepare)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAiVaultSessions).mockResolvedValue({
    sessions: [row],
    issues: [],
    scannedAt: ''
  } as unknown as Awaited<ReturnType<typeof listAiVaultSessions>>)
})
describe('recorded cwd proof on the transcript owning runtime', () => {
  it.each(['ENOENT', 'ENOTDIR'])(
    'returns absence only after identity matching and %s',
    async (code) => {
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error(code), { code }))
      await expect(commands.prepare(args)).resolves.toMatchObject({ recordedCwdMissing: true })
      expect(stat).toHaveBeenCalledExactlyOnceWith(row.cwd)
    }
  )
  it('retains an existing recorded directory', async () => {
    vi.mocked(stat).mockResolvedValue({} as Awaited<ReturnType<typeof stat>>)
    await expect(commands.prepare(args)).resolves.toMatchObject({ recordedCwdMissing: false })
  })
  it.each(['EACCES', 'EIO', 'EBUSY'])('does not call %s absence', async (code) => {
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error(code), { code }))
    await expect(commands.prepare(args)).rejects.toThrow(code)
  })
  it.each([
    { sessionId: 'forged' },
    { filePath: '/etc/passwd' },
    { codexHome: '/other' },
    { executionHostId: 'runtime:other' as const }
  ])('does not probe a mismatched identity %j', async (mismatch) => {
    await expect(commands.prepare({ ...args, ...mismatch })).resolves.toEqual({
      useRealCodexHome: false
    })
    expect(stat).not.toHaveBeenCalled()
  })
  it('does not scan when a caller requested only account preparation', async () => {
    await commands.prepare({ ...args, checkRecordedCwd: false })
    expect(listAiVaultSessions).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { linkSync, statSync, symlinkSync } from 'node:fs'
import { canBridgeCodexSessionRoots, linkCodexSessionFile } from './codex-session-link'

vi.mock('node:fs', () => ({ linkSync: vi.fn(), statSync: vi.fn(), symlinkSync: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Codex session filesystem boundaries', () => {
  it('does not walk a cross-device history tree or create unusable symlinks', () => {
    vi.mocked(statSync).mockImplementation(
      (path) => ({ dev: String(path).includes('source') ? 1 : 2 }) as ReturnType<typeof statSync>
    )
    expect(canBridgeCodexSessionRoots('/source/sessions', '/target/sessions')).toBe(false)
    expect(linkSync).not.toHaveBeenCalled()
    expect(symlinkSync).not.toHaveBeenCalled()
  })

  it('permits same-device homes and rechecks after storage changes', () => {
    vi.mocked(statSync).mockReturnValue({ dev: 1 } as ReturnType<typeof statSync>)
    expect(canBridgeCodexSessionRoots('/source/sessions', '/target/sessions')).toBe(true)
    vi.mocked(statSync).mockImplementation(
      (path) => ({ dev: String(path).includes('source') ? 1 : 2 }) as ReturnType<typeof statSync>
    )
    expect(canBridgeCodexSessionRoots('/source/sessions', '/target/sessions')).toBe(false)
  })

  it('checks an existing ancestor when the target sessions directory has not been created', () => {
    vi.mocked(statSync).mockImplementation((path) => {
      if (String(path).endsWith('sessions')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return { dev: 1 } as ReturnType<typeof statSync>
    })
    expect(canBridgeCodexSessionRoots('/source/sessions', '/target/sessions')).toBe(true)
  })

  it('keeps uncertain filesystem errors visible to the normal bridge operation', () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    expect(canBridgeCodexSessionRoots('/source', '/target')).toBe(true)
  })

  it('never creates a symlink or copy when a file cannot be hardlinked', () => {
    vi.mocked(linkSync).mockImplementation(() => {
      throw Object.assign(new Error('cross device'), { code: 'EXDEV' })
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(linkCodexSessionFile('/source/file.jsonl', '/target/file.jsonl')).toBe(false)
    expect(symlinkSync).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalled()
    warning.mockRestore()
  })
})

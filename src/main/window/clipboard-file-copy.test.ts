import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'
import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileToClipboard, type ClipboardFileDeps } from './clipboard-file-copy'

const success: ProcessResult = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }

function makeDeps(overrides: Partial<ClipboardFileDeps> = {}): ClipboardFileDeps {
  return {
    platform: 'darwin',
    desktop: undefined,
    resolveFilePath: async (path) => ({ ok: true, path }),
    writeBuffer: vi.fn(),
    runProcess: vi.fn(async () => success),
    ...overrides
  }
}

describe('writeFileToClipboard', () => {
  it('rejects relative paths without touching the clipboard', async () => {
    const writeBuffer = vi.fn()
    expect(await writeFileToClipboard('relative/file.png', makeDeps({ writeBuffer }))).toEqual({
      ok: false,
      reason: 'invalid-path'
    })
    expect(writeBuffer).not.toHaveBeenCalled()
  })

  it('rejects files that no longer exist', async () => {
    expect(
      await writeFileToClipboard(
        '/repo/gone.png',
        makeDeps({ resolveFilePath: async () => ({ ok: false, reason: 'not-found' }) })
      )
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects files outside authorized local roots', async () => {
    expect(
      await writeFileToClipboard(
        '/etc/passwd',
        makeDeps({ resolveFilePath: async () => ({ ok: false, reason: 'access-denied' }) })
      )
    ).toEqual({ ok: false, reason: 'access-denied' })
  })

  it('writes a public.file-url buffer on macOS', async () => {
    const writeBuffer = vi.fn()
    const filePath = resolve('/repo/a b.png')
    const result = await writeFileToClipboard(
      filePath,
      makeDeps({ platform: 'darwin', writeBuffer })
    )
    expect(result).toEqual({ ok: true })
    expect(writeBuffer).toHaveBeenCalledTimes(1)
    const [format, buffer] = writeBuffer.mock.calls[0]
    expect(format).toBe('public.file-url')
    // spaces are percent-encoded into the file URL
    expect(buffer.toString('utf8')).toBe(pathToFileURL(filePath).href)
  })

  it('reports a failure when the macOS clipboard write throws', async () => {
    const writeBuffer = vi.fn(() => {
      throw new Error('clipboard unavailable')
    })
    await expect(
      writeFileToClipboard('/repo/a.png', makeDeps({ platform: 'darwin', writeBuffer }))
    ).resolves.toEqual({ ok: false, reason: 'clipboard-write-failed' })
  })

  it('uses the authorized resolved path for clipboard payloads', async () => {
    const writeBuffer = vi.fn()
    const resolvedPath = resolve('/repo/actual.png')
    await writeFileToClipboard(
      '/repo/link.png',
      makeDeps({
        platform: 'darwin',
        resolveFilePath: async () => ({ ok: true, path: resolvedPath }),
        writeBuffer
      })
    )
    expect(writeBuffer).toHaveBeenCalledWith(
      'public.file-url',
      Buffer.from(pathToFileURL(resolvedPath).href, 'utf8')
    )
  })

  it('passes Windows paths through environment without script interpolation', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => success)
    const result = await writeFileToClipboard(
      "/repo/o'brien.png",
      makeDeps({ platform: 'win32', runProcess })
    )
    expect(result).toEqual({ ok: true })
    const [spec] = runProcess.mock.calls[0]
    expect(spec.program.toLowerCase()).toContain('powershell.exe')
    expect(spec.args).toContain('Set-Clipboard -LiteralPath $env:ORCA_CLIPBOARD_FILE')
    expect(spec.env?.ORCA_CLIPBOARD_FILE).toBe("/repo/o'brien.png")
  })

  it('passes typographic quotes as literal environment data', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => success)
    await writeFileToClipboard(
      '/repo/o\u2019brien.png',
      makeDeps({ platform: 'win32', runProcess })
    )
    expect(runProcess.mock.calls[0][0].env?.ORCA_CLIPBOARD_FILE).toBe('/repo/o\u2019brien.png')
  })

  it('reports a failure (never throws) when PowerShell rejects on Windows', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => {
      throw new Error('powershell.exe not found')
    })
    expect(
      await writeFileToClipboard('/repo/a.png', makeDeps({ platform: 'win32', runProcess }))
    ).toEqual({ ok: false, reason: 'clipboard-command-failed' })
  })

  it('uses the KDE text/uri-list payload on a KDE desktop', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => success)
    const filePath = resolve('/repo/a b.png')
    const result = await writeFileToClipboard(
      filePath,
      makeDeps({ platform: 'linux', desktop: 'KDE', runProcess })
    )
    expect(result).toEqual({ ok: true })
    const [{ program: command, args, input: stdin }] = runProcess.mock.calls[0]
    expect(command).toBe('wl-copy')
    expect(args).toContain('text/uri-list')
    expect(stdin).toBe(`${pathToFileURL(filePath).href}\r\n`)
  })

  it('uses the GNOME copied-files payload on non-KDE desktops', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => success)
    const filePath = resolve('/repo/a.png')
    await writeFileToClipboard(
      filePath,
      makeDeps({ platform: 'linux', desktop: 'GNOME', runProcess })
    )
    const [{ args, input: stdin }] = runProcess.mock.calls[0]
    expect(args).toContain('x-special/gnome-copied-files')
    expect(stdin).toBe(`copy\n${pathToFileURL(filePath).href}`)
  })

  it('tries each Linux tool and reports unsupported when all fail', async () => {
    const runProcess = vi.fn(async (_spec: ProcessSpec) => {
      throw new Error('command not found')
    })
    expect(
      await writeFileToClipboard('/repo/a.png', makeDeps({ platform: 'linux', runProcess }))
    ).toEqual({ ok: false, reason: 'unsupported-platform' })
    expect(runProcess).toHaveBeenCalledTimes(2) // wl-copy, then xclip
  })

  it('succeeds on Linux when a clipboard tool is available', async () => {
    const runProcess = vi.fn(async ({ program: command }: ProcessSpec) => {
      if (command === 'wl-copy') {
        return success
      }
      throw new Error('no xclip')
    })
    expect(
      await writeFileToClipboard('/repo/a.png', makeDeps({ platform: 'linux', runProcess }))
    ).toEqual({ ok: true })
    expect(runProcess.mock.calls[0][0].program).toBe('wl-copy')
  })
})

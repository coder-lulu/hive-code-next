import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyProductBranding } from '../../shared/brand'
import { serveSignalExitError } from './serve-signal-exit-diagnostic'
import {
  SERVE_EXTERNAL_SIGNAL_FORCE_KILL_TIMEOUT_MS,
  superviseForegroundServe
} from './serve-update-supervisor'
import { RuntimeClientError } from './types'

class FakeChildProcess extends EventEmitter {
  kill = vi.fn()
  pid = 5150
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function superviseUntilExit(code: number | null, signal: NodeJS.Signals | null): Promise<number> {
  const child = new FakeChildProcess()
  const supervised = superviseForegroundServe({
    executable: '/Applications/Orca.app/Contents/MacOS/Orca',
    childArgs: ['--serve'],
    spawnOptions: {},
    spawnChild: vi.fn() as never,
    handoffPath: null,
    child: child as never,
    expectedHandoff: null
  })
  child.emit('exit', code, signal)
  return supervised
}

function superviseUntilSignal(): {
  child: FakeChildProcess
  supervised: Promise<number>
  forwardSigterm: (signal: 'SIGTERM') => void
} {
  const existingListeners = new Set(process.listeners('SIGTERM'))
  const child = new FakeChildProcess()
  const supervised = superviseForegroundServe({
    executable: '/Applications/Orca.app/Contents/MacOS/Orca',
    childArgs: ['--serve'],
    spawnOptions: {},
    spawnChild: vi.fn() as never,
    handoffPath: null,
    child: child as never,
    expectedHandoff: null
  })
  const forwardSigterm = process
    .listeners('SIGTERM')
    .find((listener) => !existingListeners.has(listener))
  if (!forwardSigterm) {
    throw new Error('serve supervisor did not install a SIGTERM listener')
  }
  return { child, supervised, forwardSigterm }
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
})

describe('serveSignalExitError', () => {
  it('explains the macOS window-server abort on darwin SIGABRT', () => {
    const error = serveSignalExitError('SIGABRT', 'darwin')

    expect(error).toBeInstanceOf(RuntimeClientError)
    expect(error.code).toBe('runtime_serve_failed')
    expect(error.message).toContain('aborted with SIGABRT on macOS')
    expect(error.message).toContain('macOS window server')
    expect(error.data).toMatchObject({
      nextSteps: [
        expect.stringContaining('macOS desktop login'),
        expect.stringContaining('~/Library/Logs/DiagnosticReports/Orca-*.ips')
      ]
    })
  })

  it('does not claim the macOS cause off darwin', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const error = serveSignalExitError('SIGABRT', platform)

      expect(error.message).toBe(applyProductBranding('Orca serve exited via SIGABRT.'))
      expect(error.data).toBeUndefined()
    }
  })

  it('does not claim the macOS cause for other darwin signals', () => {
    const error = serveSignalExitError('SIGKILL', 'darwin')

    expect(error.message).toBe(applyProductBranding('Orca serve exited via SIGKILL.'))
    expect(error.data).toBeUndefined()
  })

  it('stays clear when neither a code nor a signal is reported', () => {
    expect(serveSignalExitError(null, 'darwin').message).toBe(
      applyProductBranding('Orca serve exited without reporting an exit code or signal.')
    )
  })
})

describe('superviseForegroundServe signal exits', () => {
  it('allows the Electron teardown budget before force killing an externally stopped serve', async () => {
    vi.useFakeTimers()
    const { child, supervised, forwardSigterm } = superviseUntilSignal()
    let exited = false

    try {
      forwardSigterm('SIGTERM')
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')

      await vi.advanceTimersByTimeAsync(SERVE_EXTERNAL_SIGNAL_FORCE_KILL_TIMEOUT_MS - 1)
      expect(child.kill).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
      child.emit('exit', null, 'SIGKILL')
      exited = true
      await expect(supervised).rejects.toThrow(
        applyProductBranding('Orca serve exited via SIGKILL.')
      )
    } finally {
      if (!exited) {
        child.emit('exit', 0, null)
        await supervised.catch(() => undefined)
      }
      vi.useRealTimers()
    }
  })

  it('clears the external-stop force-kill timer when Electron exits first', async () => {
    vi.useFakeTimers()
    const { child, supervised, forwardSigterm } = superviseUntilSignal()

    try {
      forwardSigterm('SIGTERM')
      child.emit('exit', 0, null)
      await expect(supervised).resolves.toBe(0)

      await vi.advanceTimersByTimeAsync(SERVE_EXTERNAL_SIGNAL_FORCE_KILL_TIMEOUT_MS)
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws the macOS diagnostic when the child aborts on darwin', async () => {
    setPlatform('darwin')

    await expect(superviseUntilExit(null, 'SIGABRT')).rejects.toThrow(
      /aborted with SIGABRT on macOS/
    )
  })

  it('reports the plain signal on linux', async () => {
    setPlatform('linux')

    await expect(superviseUntilExit(null, 'SIGABRT')).rejects.toThrow(
      applyProductBranding('Orca serve exited via SIGABRT.')
    )
  })

  it('returns numeric exit codes unchanged', async () => {
    setPlatform('darwin')

    await expect(superviseUntilExit(0, null)).resolves.toBe(0)
    await expect(superviseUntilExit(7, null)).resolves.toBe(7)
  })
})

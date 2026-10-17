import type { ProcessResult } from '@orca/process-host/process-spec'
import type { runProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn<typeof runProcess>()
}))

vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal()),
  runProcess: runProcessMock
}))

import { ghExecFileAsync } from './gh-exec-file'
import { logHostedCliDeadlineKill } from './hosted-cli-deadline-log'

/**
 * #18234 took four rounds of strace/perf/proc spelunking from the reporter
 * because a deadline kill produced no evidence at all. The resolved path is the
 * fact that names a self-recursive wrapper.
 */
describe('hosted CLI deadline logging', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    runProcessMock.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('names the CLI, the deadline and the resolved path, and never the argv values', () => {
    logHostedCliDeadlineKill(
      'gh',
      '/home/user/.local/bin/gh',
      ['api', '-H', 'Authorization: token ghp_secret'],
      15_000
    )

    const line = warn.mock.calls[0][0] as string
    expect(line).toContain('[gh]')
    expect(line).toContain('15000ms')
    expect(line).toContain('/home/user/.local/bin/gh')
    expect(line).toContain('"api"')
    expect(line).toContain('(3 args)')
    expect(line).not.toContain('ghp_secret')
    expect(line).not.toContain('Authorization')
  })

  it('logs once when gh is killed at its deadline', async () => {
    // Process-host owns OS termination; this unit completes that boundary without a real PID.
    const terminated = Promise.withResolvers<ProcessResult>()
    runProcessMock.mockReturnValue(terminated.promise)

    const rejection = expect(
      ghExecFileAsync(['api', '-H', 'Authorization: token ghp_secret'], { timeout: 15_000 })
    ).rejects.toThrow('timed out')
    expect(runProcessMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ timeoutMs: 15_000, terminationBarrier: true })
    )
    await vi.advanceTimersByTimeAsync(15_000)
    expect(warn).not.toHaveBeenCalled()
    terminated.resolve({ code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true })
    await rejection
    await vi.advanceTimersByTimeAsync(15_000)

    const deadlineLines = warn.mock.calls.filter((call) => String(call[0]).startsWith('[gh]'))
    expect(deadlineLines).toHaveLength(1)
    expect(String(deadlineLines[0][0])).toContain('wrapper script')
    expect(String(deadlineLines[0][0])).toContain('15000ms')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ghp_secret')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Authorization')
  })

  it('stays quiet when the caller aborted rather than the deadline firing', async () => {
    const controller = new AbortController()
    const terminated = Promise.withResolvers<ProcessResult>()
    runProcessMock.mockReturnValue(terminated.promise)

    const rejection = expect(
      ghExecFileAsync(['api', '--include', 'user/starred/stablyai/orca'], {
        timeout: 15_000,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted.' })
    expect(runProcessMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        timeoutMs: 15_000,
        terminationBarrier: true,
        signal: controller.signal
      })
    )
    controller.abort()
    expect(warn).not.toHaveBeenCalled()
    terminated.resolve({ code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: false })
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection

    expect(warn.mock.calls.filter((call) => String(call[0]).startsWith('[gh]'))).toHaveLength(0)
  })
})

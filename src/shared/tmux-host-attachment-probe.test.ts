import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const run = vi.hoisted(() => vi.fn())
vi.mock('./child-process/run-process', () => ({ runProcess: run }))
vi.mock('node:fs/promises', () => ({
  stat: async () => ({ isSocket: () => true, uid: process.getuid?.() })
}))
vi.mock('./agent-process-presence-probe', () => ({
  readAgentProcess: async (pid: number) => ({ verdict: 'live', startTime: `birth-${pid}` })
}))
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
let active = 0
let maximum = 0
beforeEach(() => {
  vi.resetModules()
  active = 0
  maximum = 0
  run.mockReset()
  run.mockImplementation(async (options: { program: string; args: string[] }) => {
    if (options.program === 'tmux') {
      return {
        code: 0,
        timedOut: false,
        stdout: Array.from({ length: 16 }, (_, i) => `${101 + i}:%${i}`).join('\n')
      }
    }
    const pid = Number(options.args[1])
    active++
    maximum = Math.max(maximum, active)
    await Promise.resolve()
    active--
    const start = process.platform === 'darwin' ? 'Fri Oct  2 03:00:00 2026' : '100'
    return {
      code: 0,
      timedOut: false,
      stdout: `${pid} ${pid === 100 ? 1 : 100} ${pid} ${pid === 100 ? 101 : pid} S pts/1 ${start} ${pid === 100 ? '/bin/bash' : '/usr/bin/tmux attach'}\n`
    }
  })
})
afterEach(() => Object.defineProperty(process, 'platform', hostPlatform))

describe('bounded targeted tmux process capture', () => {
  it.each(['linux', 'darwin'] as const)(
    'captures sixteen clients plus the root in bounded batches without a whole-host scan on %s',
    async (platform) => {
      Object.defineProperty(process, 'platform', { ...hostPlatform, value: platform })
      const { probeTmuxHostAttachments } = await import('./tmux-host-attachment-probe.js')
      const proof = await probeTmuxHostAttachments('/tmp/fixture.sock', [100])
      expect(proof?.clients).toHaveLength(16)
      expect(proof?.rows).toHaveLength(17)
      const calls = run.mock.calls.filter(([options]) => options.program === '/bin/ps')
      expect(calls).toHaveLength(17)
      expect(maximum).toBeLessThanOrEqual(16)
      expect(
        calls.every(([options]) => options.args[0] === '-p' && /^[0-9]+$/.test(options.args[1]))
      ).toBe(true)
      expect(
        calls.every(
          ([options]) =>
            options.args[2] === '-o' &&
            options.args[3] ===
              (platform === 'darwin'
                ? 'pid=,ppid=,pgid=,tpgid=,stat=,tty=,lstart=,command='
                : 'pid=,ppid=,pgid=,tpgid=,stat=,tty=,etimes=,command=')
        )
      ).toBe(true)
    }
  )

  it('refuses native Windows capture without launching tmux or ps', async () => {
    Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'win32' })
    const { probeTmuxHostAttachments } = await import('./tmux-host-attachment-probe.js')
    expect(await probeTmuxHostAttachments('/tmp/fixture.sock', [100])).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spawnProcess } from '../../shared/child-process/run-process'
import {
  openCodexAppServerConnection,
  type CodexAppServerConnection
} from './codex-app-server-connection'
import { CodexAppServerFrameSizeError } from './codex-app-server-frame-size-error'

const opened = new Set<CodexAppServerConnection>()
afterEach(async () => {
  await Promise.all([...opened].map((connection) => connection.close()))
  opened.clear()
})

describe('Codex transport stdout frame bound', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'rejects invalid limit %s before spawning',
    async (maxFrameBytes) => {
      const spawn = vi.fn<typeof spawnProcess>(() => {
        throw new Error('unexpected spawn')
      })
      await expect(
        openCodexAppServerConnection(
          { command: process.execPath, args: [], maxFrameBytes },
          {},
          spawn
        )
      ).rejects.toThrow('invalid Codex stdout frame limit')
      expect(spawn).not.toHaveBeenCalled()
    }
  )

  it('closes a real child after a bounded unterminated stdout flood', async () => {
    const script = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line)
        if (message.method === 'initialize') {
          process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n')
        } else if (message.method === 'test/flood') {
          process.stdout.write('x'.repeat(257))
        }
      })
    `
    const onExit = vi.fn()
    const connection = await openCodexAppServerConnection(
      { command: process.execPath, args: ['-e', script], maxFrameBytes: 256 },
      { onExit }
    )
    opened.add(connection)
    await expect(connection.request('test/flood', {}, { timeoutMs: 2000 })).rejects.toThrow(
      new CodexAppServerFrameSizeError(null, 257, 256).message
    )
    expect(connection.closed).toBe(true)
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(await connection.close()).toBe(true)
  })
})

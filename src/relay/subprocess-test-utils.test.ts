import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { spawnRelay, type RelayProcess } from './subprocess-test-utils'

let directory: string
const started: { relay: RelayProcess; closed: Promise<void> }[] = []

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'relay-readiness-'))
})

afterEach(async () => {
  for (const { relay } of started) {
    if (relay.proc.pid && relay.proc.exitCode === null && relay.proc.signalCode === null) {
      relay.kill('SIGKILL')
    }
  }
  await Promise.all(started.map(({ closed }) => closed))
  started.length = 0
  await rm(directory, { recursive: true, force: true })
})

function start(entry: string, options: Pick<SpawnOptions, 'cwd' | 'env'> = {}): RelayProcess {
  const relay = spawnRelay(entry, [], options)
  const closed = new Promise<void>((resolve) => relay.proc.once('close', resolve))
  started.push({ relay, closed })
  return relay
}

it('rejects readiness when the real child exits before publishing a sentinel', async () => {
  const entry = join(directory, 'early-exit.js')
  writeFileSync(
    entry,
    "process.stderr.write('fixture exited before readiness\\n'); process.exitCode = 17\n"
  )
  const relay = start(entry)

  await expect(relay.sentinelReceived).rejects.toThrow('fixture exited before readiness')
  expect(await relay.waitForExit()).toBe(17)
})

it('reports real MODULE_NOT_FOUND stderr when the requested entry is absent', async () => {
  const relay = start(join(directory, 'missing-entry.js'))

  await expect(relay.sentinelReceived).rejects.toThrow('MODULE_NOT_FOUND')
  expect(await relay.waitForExit()).toBe(1)
})

it('preserves the real spawn error when its working directory is unavailable', async () => {
  const relay = start(join(directory, 'unused.js'), { cwd: join(directory, 'missing-directory') })

  await expect(relay.sentinelReceived).rejects.toMatchObject({ code: 'ENOENT' })
  expect(relay.proc.pid).toBeUndefined()
})

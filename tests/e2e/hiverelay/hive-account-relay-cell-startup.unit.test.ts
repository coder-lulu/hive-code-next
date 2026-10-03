import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runProcess, spawnProcess } from '../../../src/shared/child-process/run-process'
import { forceTerminateProcessTree } from '../../../src/shared/child-process/process-tree-termination'
import { createFakeSpawnedChild } from '../../../src/shared/child-process/__fixtures__/fake-spawned-child'
import { startAccountRelayCell } from './hive-account-relay-cell-fixture'

vi.mock('../../../src/shared/child-process/run-process', () => ({
  runProcess: vi.fn(),
  spawnProcess: vi.fn()
}))
vi.mock('../../../src/shared/child-process/process-tree-termination', () => ({
  forceTerminateProcessTree: vi.fn()
}))

const artifactRoot = resolve('logs/open-source-baseline/relay-cell-startup')
let directory: string
let child: ReturnType<typeof spawnProcess>
const nextTurn = () => new Promise<void>((done) => setImmediate(done))

function close(code = 0, signal: NodeJS.Signals | null = null) {
  Object.assign(child, { exitCode: code, signalCode: signal })
  child.emit('exit', code, signal)
  child.emit('close', code, signal)
}

function ready() {
  writeFileSync(
    join(directory, 'ready.json'),
    JSON.stringify({
      cellId: 'cell-startup',
      cellIncarnationId: 'incarnation-startup',
      port: 12345,
      processPid: '4321',
      privateOrigin: null,
      caPemPath: null,
      clientPkcs12Path: null
    })
  )
}

function observeStartup() {
  const result: { error?: unknown; cell?: Awaited<ReturnType<typeof startAccountRelayCell>> } = {}
  const settled = startAccountRelayCell(directory, 'cell-startup', 'public-signing-key').then(
    (cell) => {
      result.cell = cell
    },
    (error) => {
      result.error = error
    }
  )
  return { result, settled }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('HIVE_RELAY_CELL_SOURCE', undefined)
  mkdirSync(artifactRoot, { recursive: true })
  directory = mkdtempSync(join(artifactRoot, 'cell-'))
  child = createFakeSpawnedChild() as ReturnType<typeof spawnProcess>
  Object.assign(child, { exitCode: null, signalCode: null })
  vi.mocked(child.kill).mockImplementation(() => {
    queueMicrotask(() => close(0, 'SIGKILL'))
    return true
  })
  vi.mocked(forceTerminateProcessTree).mockImplementation(async (ownedChild) => {
    ownedChild.kill('SIGKILL')
    return true
  })
  vi.mocked(runProcess).mockImplementation(async () => {
    writeFileSync(join(directory, 'cert.pem'), 'unit certificate bytes')
    return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
  })
  vi.mocked(spawnProcess).mockReturnValue(child)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  expect(dirname(directory)).toBe(artifactRoot)
  expect(basename(directory)).toMatch(/^cell-/)
  rmSync(directory, { recursive: true, force: true })
})

it('observes spawn ENOENT immediately without a deferred close rejection', async () => {
  const failure = Object.assign(new Error('spawn mise ENOENT'), { code: 'ENOENT' })
  const startup = observeStartup()
  await nextTurn()
  child.emit('error', failure)
  close(-2)
  await nextTurn()
  expect(startup.result.error).toBe(failure)
  expect(child.kill).not.toHaveBeenCalled()
  await startup.settled
})

it('fails immediately when the Cell closes before readiness', async () => {
  const startup = observeStartup()
  await nextTurn()
  child.stderr.emit('data', Buffer.from('mix could not load the Cell'))
  close(17)
  await nextTurn()
  expect(startup.result.error).toEqual(
    expect.objectContaining({ message: expect.stringContaining('mix could not load the Cell') })
  )
  expect(child.kill).not.toHaveBeenCalled()
  await startup.settled
})

it('keeps a startup parse failure when stop-file cleanup fails and closes its child', async () => {
  writeFileSync(join(directory, 'ready.json'), '{')
  mkdirSync(join(directory, 'stop'))
  const startup = observeStartup()
  await nextTurn()
  expect(startup.result.error).toBeInstanceOf(SyntaxError)
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  expect(forceTerminateProcessTree).toHaveBeenCalledWith(child)
  expect(child.exitCode).not.toBeNull()
  await startup.settled
})

it('uses the default sibling Cell source and exact BEAM pins, then waits for physical close', async () => {
  ready()
  const cell = await startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
  expect(vi.mocked(spawnProcess).mock.calls[0][0]).toMatchObject({
    program: 'mise',
    cwd: resolve('../hive-relay-cell'),
    detached: true,
    args: [
      'exec',
      'elixir@1.20.2-otp-29',
      'erlang@29.0.3',
      '--',
      'mix',
      'run',
      '--no-start',
      resolve('tests/e2e/hiverelay/hive-account-relay-cell-fixture.exs')
    ],
    env: expect.objectContaining({ HIVE_P4_CELL_FIXTURE: directory })
  })
  let finished = false
  const stopped = cell.stop()
  expect(cell.stop()).toBe(stopped)
  const stopping = stopped.then(() => {
    finished = true
  })
  await nextTurn()
  expect(readFileSync(join(directory, 'stop'), 'utf8')).toBe('')
  expect(finished).toBe(false)
  close()
  await stopping
  expect(finished).toBe(true)
  await cell.stop()
  expect(child.kill).not.toHaveBeenCalled()
})

it('accepts an explicit absolute Cell source without changing the fixture or BEAM pins', async () => {
  const source = resolve(artifactRoot, 'private-cell-source')
  vi.stubEnv('HIVE_RELAY_CELL_SOURCE', source)
  ready()
  const cell = await startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
  expect(vi.mocked(spawnProcess).mock.calls[0][0].cwd).toBe(source)
  close()
  await cell.stop()
})

it.each(['relative/cell', ''])(
  'rejects the non-absolute explicit Cell source %j before preparing processes',
  async (source) => {
    vi.stubEnv('HIVE_RELAY_CELL_SOURCE', source)
    await expect(
      startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
    ).rejects.toThrow('HIVE_RELAY_CELL_SOURCE must be an absolute path')
    expect(runProcess).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  }
)

it('forces and awaits an owned child that does not acknowledge the stop marker', async () => {
  vi.useFakeTimers()
  ready()
  const cell = await startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
  const stopping = cell.stop()
  await vi.advanceTimersByTimeAsync(5_000)
  await stopping
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  expect(forceTerminateProcessTree).toHaveBeenCalledWith(child)
  expect(child.signalCode).toBe('SIGKILL')
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps the original 30-second readiness deadline and clears polling while stopping', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const startup = observeStartup()
  await nextTurn()
  await vi.advanceTimersByTimeAsync(29_999)
  expect(startup.result.error).toBeUndefined()
  expect(child.kill).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(readFileSync(join(directory, 'stop'), 'utf8')).toBe('')
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(5_000)
  await startup.settled
  expect(startup.result.error).toEqual(
    expect.objectContaining({ message: expect.stringContaining('timed out in 30000ms') })
  )
  expect(child.signalCode).toBe('SIGKILL')
  expect(vi.getTimerCount()).toBe(0)
})

it('retains an error after readiness without a background rejecting promise', async () => {
  ready()
  const cell = await startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
  const failure = new Error('Cell process failed after readiness')
  child.emit('error', failure)
  close(1)
  await nextTurn()
  await expect(cell.stop()).rejects.toBe(failure)
  expect(child.kill).not.toHaveBeenCalled()
})

it('rejects a synchronous spawn refusal as the original error', async () => {
  const failure = new Error('mise spawn was refused')
  vi.mocked(spawnProcess).mockImplementation(() => {
    throw failure
  })
  await expect(startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')).rejects.toBe(
    failure
  )
  expect(child.kill).not.toHaveBeenCalled()
})

it('does not return a ready Cell that exited before its streams closed', async () => {
  ready()
  vi.mocked(spawnProcess).mockImplementation(() => {
    queueMicrotask(() => {
      Object.assign(child, { exitCode: 0 })
      child.emit('exit', 0, null)
    })
    return child
  })
  const startup = observeStartup()
  await nextTurn()
  try {
    expect(startup.result.cell).toBeUndefined()
    child.emit('close', 0, null)
    await startup.settled
    expect(startup.result.error).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Cell exited') })
    )
  } finally {
    child.emit('close', 0, null)
    await startup.result.cell?.stop()
  }
})

it('does not declare an unverified tree cleanup successful after the root closes', async () => {
  vi.useFakeTimers()
  ready()
  vi.mocked(forceTerminateProcessTree).mockImplementation(async (ownedChild) => {
    ownedChild.kill('SIGKILL')
    return false
  })
  const cell = await startAccountRelayCell(directory, 'cell-startup', 'public-signing-key')
  const stopping = cell.stop()
  const rejected = expect(stopping).rejects.toThrow('Cell fixture tree termination unverified')
  await vi.advanceTimersByTimeAsync(5_000)
  await rejected
  expect(forceTerminateProcessTree).toHaveBeenCalledWith(child)
  expect(child.exitCode).not.toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

// The current desktop and Orcad runtime share this installed pnpm-patched payload.
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const projectDir = join(import.meta.dirname, '..', '..')
const desktopPath = (file) => join(projectDir, 'node_modules', 'node-pty', 'lib', file)
const conoutSource = () => readFileSync(desktopPath('windowsConoutConnection.js'), 'utf8')

describe('ConPTY output Worker error ownership', () => {
  it.each([
    ['desktop', false],
    ['desktop', true]
  ])(
    'contains a retired %s Worker EPIPE with DLL=%s while a neighboring connection remains active',
    async (tree, useDll) => {
      const harness = loadConoutConnection(conoutSource(tree))
      const retired = new harness.ConoutConnection('retired-pipe', useDll)
      const witness = new harness.ConoutConnection('witness-pipe', useDll)
      let ready = 0
      witness.onReady(() => ready++)

      retired.dispose()
      retired.dispose()
      const failure = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' })
      expect(() => harness.workers[0].emit('error', failure)).not.toThrow()
      harness.workers[1].emit('message', 1)
      expect(ready).toBe(1)
      expect(witness._isDisposed).toBe(false)
      expect(harness.timers.size).toBe(1)
      const [timer] = harness.timers.values()
      expect(timer.delay).toBe(1000)
      expect(harness.workers[0].terminated).toBe(0)
      await timer.callback()
      expect(harness.workers[0].terminated).toBe(1)
      expect(harness.workers[1].terminated).toBe(0)
    }
  )

  it.each(
    ['desktop'].flatMap((tree) => [
      [tree, false, 'EPIPE'],
      [tree, false, 'ECONNRESET'],
      [tree, true, 'ECONNRESET'],
      [tree, true, 'ERR_STREAM_DESTROYED'],
      [tree, true, undefined]
    ])
  )('preserves the original %s error for disposed=%s and code=%s', (tree, disposed, code) => {
    const harness = loadConoutConnection(conoutSource(tree))
    const connection = new harness.ConoutConnection('error-pipe', false)
    if (disposed) {
      connection.dispose()
    }
    const failure = Object.assign(new Error('unexpected Worker failure'), { code })
    let received
    try {
      harness.workers[0].emit('error', failure)
    } catch (error) {
      received = error
    }
    expect(received).toBe(failure)
  })
})

function loadConoutConnection(source) {
  const workers = []
  const timers = new Map()
  class TestWorker extends EventEmitter {
    terminated = 0
    constructor() {
      super()
      workers.push(this)
    }
    async terminate() {
      this.terminated++
      return 0
    }
  }
  const module = { exports: {} }
  const libraryDir = dirname(desktopPath('windowsConoutConnection.js'))
  runInNewContext(source, {
    module,
    exports: module.exports,
    __dirname: libraryDir,
    console,
    require(specifier) {
      if (specifier === 'worker_threads') {
        return { Worker: TestWorker }
      }
      if (specifier === './eventEmitter2' || specifier === './shared/conout') {
        return require(join(libraryDir, specifier))
      }
      if (specifier === 'path') {
        return require('node:path')
      }
      throw new Error(`Unexpected ConoutConnection import: ${specifier}`)
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay }
      timers.set(timer, timer)
      return timer
    },
    clearTimeout(timer) {
      timers.delete(timer)
    }
  })
  return { ConoutConnection: module.exports.ConoutConnection, workers, timers }
}

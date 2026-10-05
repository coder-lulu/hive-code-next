import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { spawnProcess } from '../../shared/child-process/run-process'
import {
  __setWindowsProcessTreeRequireForTests,
  readWindowsProcessCreationTime,
  readWindowsProcessTableFresh,
  requestWindowsProcessTermination
} from './windows-process-table'

const nativeRequire = createRequire(import.meta.url)
const packageDir = process.env.HIVE_WINDOWS_PROCESS_TREE_TEST_PACKAGE
let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  try {
    await cleanup?.()
  } finally {
    cleanup = undefined
    __setWindowsProcessTreeRequireForTests()
  }
})

it.runIf(process.platform === 'win32')(
  'rejects malformed and replacement identities, then closes only its own child through the real native addon',
  async () => {
    const native: {
      getProcessCreationTime: (pid: number) => number | undefined
      terminateProcessIfCreationTimeMatches: (pid: number, birth: number) => boolean
    } = nativeRequire(
      packageDir ? join(packageDir, 'lib/index.js') : '@vscode/windows-process-tree'
    )
    expect(typeof native.terminateProcessIfCreationTimeMatches).toBe('function')
    if (packageDir) {
      __setWindowsProcessTreeRequireForTests(() => native)
    }
    const child = spawnProcess({
      program: process.execPath,
      args: ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)']
    })
    const closed = Promise.withResolvers<void>()
    child.once('close', () => closed.resolve())
    child.once('error', (error) => closed.reject(error))
    cleanup = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await closed.promise
    }
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve())
      child.once('error', reject)
      child.once('exit', () => reject(new Error('owned child exited before readiness')))
    })
    const pid = child.pid
    expect(pid).toBeTypeOf('number')
    if (!pid) {
      throw new Error('owned child PID unavailable')
    }
    const birth = readWindowsProcessCreationTime(pid)
    expect(birth).toBeTypeOf('number')
    if (!birth) {
      throw new Error('native owned child birth unavailable')
    }
    expect(native.terminateProcessIfCreationTimeMatches(pid, birth + 1)).toBe(false)
    expect(native.terminateProcessIfCreationTimeMatches(pid, Number.NaN)).toBe(false)
    expect(native.terminateProcessIfCreationTimeMatches(pid, 0)).toBe(false)
    expect(native.terminateProcessIfCreationTimeMatches(0, birth)).toBe(false)
    expect(native.terminateProcessIfCreationTimeMatches(0x100000000, birth)).toBe(false)
    expect(
      native.terminateProcessIfCreationTimeMatches(
        process.pid,
        native.getProcessCreationTime(process.pid) ?? 0
      )
    ).toBe(false)
    expect(requestWindowsProcessTermination(pid, birth + 1)).toBe('unavailable')
    expect(requestWindowsProcessTermination(pid, 0)).toBe('unavailable')
    expect(requestWindowsProcessTermination(0, birth)).toBe('unavailable')
    expect(requestWindowsProcessTermination(process.pid, birth)).toBe('unavailable')
    expect(readWindowsProcessCreationTime(pid)).toBe(birth)
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()

    expect(requestWindowsProcessTermination(pid, birth)).toBe('requested')
    await closed.promise
    expect(
      (await readWindowsProcessTableFresh()).some(
        (row) => row.pid === pid && row.creationTimeMs === birth
      )
    ).toBe(false)
    expect(requestWindowsProcessTermination(pid, birth)).toBe('unavailable')
  }
)

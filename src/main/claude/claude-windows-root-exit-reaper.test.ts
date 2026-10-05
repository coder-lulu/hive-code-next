import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowsProcessIdentityRow } from '../windows/windows-process-table'
import { createClaudeChildTreeReaper, proveClaudeChildExit } from './claude-agent-sdk-exit-proof'

const windows = vi.hoisted(() => ({ read: vi.fn(), terminate: vi.fn(), request: vi.fn() }))
vi.mock('../windows/windows-process-table', () => ({
  readWindowsProcessTableFresh: windows.read,
  requestWindowsProcessTermination: windows.request
}))
vi.mock('../windows-process-tree-kill', () => ({ terminateWindowsProcessTree: windows.terminate }))

const rootBirth = 1_700_000_000_000
const rootRow = { pid: 100, ppid: 1, name: 'owned-root', creationTimeMs: rootBirth }
const childRow = { pid: 200, ppid: 100, name: 'owned-child', creationTimeMs: rootBirth + 1 }
const foreignRow = { pid: 300, ppid: 1, name: 'unrelated', creationTimeMs: rootBirth + 2 }
let rows: WindowsProcessIdentityRow[]
let unreadable: boolean

beforeEach(() => {
  rows = [rootRow, childRow, foreignRow]
  unreadable = false
  vi.clearAllMocks()
  windows.read.mockImplementation(async () => {
    if (unreadable) {
      throw new Error('process table unavailable')
    }
    return [...rows]
  })
  windows.terminate.mockImplementation(async (pid: number) => {
    rows = rows.filter((row) => row.pid !== pid)
  })
  windows.request.mockImplementation((pid: number, birth: number) => {
    rows = rows.filter((row) => row.pid !== pid || row.creationTimeMs !== birth)
    return 'requested'
  })
})

function fixture(onRootExit: () => void = () => {}) {
  let exited = false
  const exit = Promise.withResolvers<void>()
  const child = { pid: rootRow.pid, stdin: new PassThrough(), kill: vi.fn(() => true) }
  child.stdin.on('finish', () => {
    rows = rows.filter((row) => row.pid !== rootRow.pid)
    exited = true
    onRootExit()
    exit.resolve()
  })
  const tree = createClaudeChildTreeReaper(child, { platform: 'win32', exited: () => exited })
  return {
    child,
    tree,
    prove: () =>
      proveClaudeChildExit({ child, tree, exited: () => exited, exitPromise: exit.promise })
  }
}

describe('Windows Claude descendants after owned root exit', () => {
  it('does not turn an unavailable native request into taskkill or exit proof', async () => {
    windows.request.mockReturnValue('unavailable')
    const { prove, tree } = fixture()
    await expect(prove()).resolves.toBe(false)
    expect(windows.request).toHaveBeenCalledExactlyOnceWith(childRow.pid, childRow.creationTimeMs)
    expect(windows.terminate).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('live')
  })

  it('does not treat a requested termination as exit while the retained child remains live', async () => {
    windows.request.mockReturnValue('requested')
    const { prove, tree } = fixture()
    await expect(prove()).resolves.toBe(false)
    expect(windows.terminate).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('live')
  })

  it('keeps five unidentified descendants unverifiable after the known child exits', async () => {
    const unknown = Array.from({ length: 5 }, (_, index) => ({
      pid: 400 + index,
      ppid: rootRow.pid,
      name: 'unidentified-child'
    }))
    rows.push(...unknown)
    const { prove, tree } = fixture()
    await expect(prove()).resolves.toBe(false)
    expect(windows.request).toHaveBeenCalledExactlyOnceWith(childRow.pid, childRow.creationTimeMs)
    expect(windows.terminate).not.toHaveBeenCalled()
    expect(rows).toEqual([foreignRow, ...unknown])
    expect(tree.treeVerdict).toBe('unverifiable')
  })

  it('stops a child recorded while the root lived after the root exits on stdin end', async () => {
    const { prove, child, tree } = fixture()

    await expect(prove()).resolves.toBe(true)

    expect(windows.request).toHaveBeenCalledExactlyOnceWith(childRow.pid, childRow.creationTimeMs)
    expect(windows.terminate).not.toHaveBeenCalled()
    expect(rows).toEqual([foreignRow])
    expect(tree.treeVerdict).toBe('exited')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('retains child ownership without signalling a replacement at the dead root PID', async () => {
    const replacement = { ...rootRow, creationTimeMs: rootBirth + 99 }
    const { prove } = fixture(() => rows.push(replacement))

    await expect(prove()).resolves.toBe(true)

    expect(windows.request).toHaveBeenCalledExactlyOnceWith(childRow.pid, childRow.creationTimeMs)
    expect(windows.terminate).not.toHaveBeenCalled()
    expect(rows).toEqual([foreignRow, replacement])
  })

  it('never signals a child PID whose creation time no longer matches the retained child', async () => {
    const replacement = { ...childRow, creationTimeMs: rootBirth + 99 }
    const { prove } = fixture(() => {
      rows = [replacement, foreignRow]
    })

    await expect(prove()).resolves.toBe(true)

    expect(windows.terminate).not.toHaveBeenCalled()
    expect(windows.request).not.toHaveBeenCalled()
    expect(rows).toEqual([replacement, foreignRow])
  })

  it('refuses signalling and exit proof when a retained child denies its current birth', async () => {
    const { prove, tree } = fixture(() => {
      rows = [{ pid: childRow.pid, ppid: rootRow.pid, name: childRow.name }, foreignRow]
    })

    await expect(prove()).resolves.toBe(false)

    expect(windows.terminate).not.toHaveBeenCalled()
    expect(windows.request).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('unverifiable')
  })

  it('refuses ambiguous duplicate child rows instead of signalling either identity', async () => {
    const { prove, tree } = fixture(() => {
      rows = [childRow, { ...childRow }, foreignRow]
    })

    await expect(prove()).resolves.toBe(false)

    expect(windows.terminate).not.toHaveBeenCalled()
    expect(windows.request).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('unverifiable')
  })

  it('keeps table failure unverifiable without signalling a captured PID', async () => {
    const { prove, tree } = fixture(() => {
      unreadable = true
    })

    await expect(prove()).resolves.toBe(false)

    expect(windows.terminate).not.toHaveBeenCalled()
    expect(windows.request).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('unverifiable')
  })

  it('does not infer ownership of an unobserved child after an already exited root', async () => {
    rows = [childRow, foreignRow]
    const child = { pid: rootRow.pid, stdin: new PassThrough(), kill: vi.fn(() => true) }
    const tree = createClaudeChildTreeReaper(child, { platform: 'win32', exited: () => true })

    await expect(
      proveClaudeChildExit({ child, tree, exited: () => true, exitPromise: Promise.resolve() })
    ).resolves.toBe(false)

    expect(windows.terminate).not.toHaveBeenCalled()
    expect(windows.request).not.toHaveBeenCalled()
    expect(windows.read).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
    expect(tree.treeVerdict).toBe('unverifiable')
  })
})

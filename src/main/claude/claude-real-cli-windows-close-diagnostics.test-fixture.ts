import { vi } from 'vitest'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import type * as WindowsDescendants from '../windows-descendant-exit-verification'
import type * as WindowsTable from '../windows/windows-process-table'
import type * as WindowsKill from '../windows-process-tree-kill'
import type * as NativeProcess from 'node:child_process'

const proof = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = []
  return {
    roots: new Set<number>(),
    identities: new Map<number, number>(),
    pendingCaptures: new Map<number, WindowsDescendants.WindowsDescendantSnapshot | null>(),
    rows,
    dropped: 0
  }
})

function record(row: Record<string, unknown>): void {
  if (proof.rows.length < 1024) {
    proof.rows.push({ at: Date.now(), ...row })
  } else {
    proof.dropped += 1
  }
}

function recordCapture(
  rootPid: number,
  snapshot: WindowsDescendants.WindowsDescendantSnapshot | null
): void {
  for (const row of snapshot ? [snapshot.root, ...snapshot.descendants] : []) {
    if (!proof.identities.has(row.pid)) {
      proof.identities.set(row.pid, row.creationTimeMs)
    }
  }
  record({ type: 'capture', rootPid, snapshot })
}

function errorField(error: unknown, key: 'code' | 'signal' | 'killed'): unknown {
  const value: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, key) : undefined
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

vi.mock('../windows-descendant-exit-verification', async (importOriginal) => {
  const actual = await importOriginal<typeof WindowsDescendants>()
  return {
    ...actual,
    captureWindowsDescendantSnapshot: async (
      ...args: Parameters<typeof actual.captureWindowsDescendantSnapshot>
    ) => {
      const snapshot = await actual.captureWindowsDescendantSnapshot(...args)
      if (proof.roots.has(args[0])) {
        recordCapture(args[0], snapshot)
      } else {
        proof.pendingCaptures.set(args[0], snapshot)
      }
      return snapshot
    }
  }
})

vi.mock('../windows/windows-process-table', async (importOriginal) => {
  const actual = await importOriginal<typeof WindowsTable>()
  const stagedPackage = process.env.HIVE_WINDOWS_PROCESS_TREE_TEST_PACKAGE
  if (stagedPackage && process.platform === 'win32') {
    if (!isAbsolute(stagedPackage)) {
      throw new Error('native fixture package must be absolute')
    }
    const requireNative = createRequire(import.meta.url)
    const native: unknown = requireNative(join(stagedPackage, 'lib/index.js'))
    const { assertWindowsProcessTreeCreationTime } = requireNative(
      '../../../config/scripts/windows-process-tree-creation-time.cjs'
    )
    assertWindowsProcessTreeCreationTime({ module: native })
    actual.__setWindowsProcessTreeRequireForTests((specifier) =>
      specifier === '@vscode/windows-process-tree' ? native : requireNative(specifier)
    )
  }
  return {
    ...actual,
    requestWindowsProcessTermination: (pid: number, birth: number) => {
      const outcome = actual.requestWindowsProcessTermination(pid, birth)
      if (proof.identities.get(pid) === birth) {
        record({ type: 'native-identified-request', pid, expectedBirth: birth, outcome })
      }
      return outcome
    },
    readWindowsProcessTableFresh: async () => {
      record({ type: 'fresh-table-start', targetPids: [...proof.identities.keys()] })
      try {
        const rows = await actual.readWindowsProcessTableFresh()
        const targets = [...proof.identities].map(([pid, birth]) => {
          const matches = rows.filter((row) => row.pid === pid)
          let state = 'matched'
          if (matches.length !== 1) {
            state = matches.length === 0 ? 'missing' : 'duplicate'
          } else if (!Number.isFinite(matches[0]?.creationTimeMs)) {
            state = 'missingBirth'
          } else if (matches[0]?.creationTimeMs !== birth) {
            state = 'changedBirth'
          }
          return { pid, expectedBirth: birth, currentBirth: matches[0]?.creationTimeMs, state }
        })
        record({ type: 'fresh-table', targets })
        return rows
      } catch (error) {
        record({
          type: 'fresh-table-error',
          errorClass: error instanceof Error ? error.name : typeof error
        })
        throw error
      }
    }
  }
})

vi.mock('../windows-process-tree-kill', async (importOriginal) => {
  const actual = await importOriginal<typeof WindowsKill>()
  const native = await vi.importActual<typeof NativeProcess>('node:child_process')
  return {
    ...actual,
    terminateWindowsProcessTree: async (
      ...args: Parameters<typeof actual.terminateWindowsProcessTree>
    ) => {
      const [pid, deps] = args
      if (!proof.identities.has(pid)) {
        return actual.terminateWindowsProcessTree(...args)
      }
      let dispatched = false
      record({ type: 'guarded-kill-enter', pid, expectedBirth: proof.identities.get(pid) })
      const execFileImpl = new Proxy(deps?.execFileImpl ?? native.execFile, {
        apply(execFile, receiver, nativeArgs) {
          const callback = nativeArgs[3]
          const startedAt = Date.now()
          dispatched = true
          record({ type: 'native-dispatch', pid })
          return Reflect.apply(execFile, receiver, [
            ...nativeArgs.slice(0, 3),
            function (this: unknown, error: unknown, ...output: unknown[]) {
              record({
                type: 'native-callback',
                pid,
                code: errorField(error, 'code'),
                signal: errorField(error, 'signal'),
                killed: errorField(error, 'killed'),
                errorPresent: error !== null,
                durationMs: Date.now() - startedAt
              })
              return Reflect.apply(callback, this, [error, ...output])
            }
          ])
        }
      })
      try {
        return await actual.terminateWindowsProcessTree(pid, { ...deps, execFileImpl })
      } finally {
        record({ type: 'guarded-kill-return', pid, dispatched })
      }
    }
  }
})

export function registerWindowsCloseRoot(
  pid: number | undefined,
  birth: number | null | undefined
): void {
  if (pid === undefined) {
    return
  }
  proof.roots.add(pid)
  if (typeof birth === 'number') {
    proof.identities.set(pid, birth)
  }
  if (proof.pendingCaptures.has(pid)) {
    recordCapture(pid, proof.pendingCaptures.get(pid) ?? null)
    proof.pendingCaptures.delete(pid)
  }
}

export function takeWindowsCloseProofRows(): Record<string, unknown>[] {
  const rows = proof.rows.splice(0)
  if (proof.dropped > 0) {
    rows.push({ type: 'diagnostic-limit', dropped: proof.dropped })
  }
  proof.identities.clear()
  proof.roots.clear()
  proof.pendingCaptures.clear()
  proof.dropped = 0
  return rows
}

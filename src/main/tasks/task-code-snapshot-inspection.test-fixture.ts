import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { afterEach, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { codeSnapshotFixture } from './task-code-snapshot.test-fixture'

const roots: string[] = []
const fixtureRoot = resolve(
  'logs/paperclip-development/p3/case-code-inspection/verification/snapshot/tmp'
)
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    roots.splice(0).map((root) => {
      const target = resolve(root)
      if (!target.startsWith(fixtureRoot + sep)) {
        throw new Error('Unowned snapshot fixture root')
      }
      return rm(target, { recursive: true, force: true })
    })
  )
})

/** Actual files and original terminal records; producer/stop/account evidence is synthetic. */
export async function snapshotInspectionFixture() {
  const f = await codeSnapshotFixture('succeeded', fixtureRoot)
  roots.push(f.root)
  let revoked = false
  const guard = vi.fn(() => {
    if (revoked) {
      throw new Error('FORBIDDEN')
    }
  })
  const snapshots = new TaskCodeSnapshotStore(f.artifacts)
  const query = {
    projectId: randomUUID(),
    caseId: randomUUID(),
    handoffRef: 'handoff:synthetic-inspection'
  }
  return {
    ...f,
    snapshots,
    query,
    guard,
    revoke: () => {
      revoked = true
    }
  }
}

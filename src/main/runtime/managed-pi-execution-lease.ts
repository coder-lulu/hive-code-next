import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import type {
  AgentSessionProcessIdentity,
  AgentSessionRecord
} from '../../shared/agent-session-record'
import { hiveAgentSessionIdSchema } from '../../shared/hive-agent-session-schema'
import { hiveAgentTextPackManifestSchema } from '../../shared/hive-agent-text-pack'
import {
  commitAgentSessionProcessIdentity,
  proveAgentSessionOwner
} from './agent-session-lease-transitions'
import { releaseAgentSessionOwnerAfterSurfaceClose } from './agent-session-surface-release-transition'
import {
  AGENT_SESSION_LEASE_TTL_MS,
  type AgentSessionRecordStore
} from './agent-session-record-store'
import type { ManagedPiExecutionOwnership } from './managed-pi-process-supervisor'
import type { VerifiedManagedPiPack } from './managed-pi-runtime-identity'

export type ManagedPiSessionScope = Readonly<{
  sessionId: string
  accountId: string
  deviceId: string
  runtimeRecordId: string
  projectScope: string
  workspaceKind: 'folder' | 'git-worktree'
}>
export function managedPiExecutionRecordId(sessionId: string): string {
  hiveAgentSessionIdSchema.parse(sessionId)
  return `managed_pi_${createHash('sha256').update(sessionId).digest('hex')}`
}

/** Uses the runtime's existing durable records, CAS and operation ledger. */
export async function reserveManagedPiExecutionLease(options: {
  store: AgentSessionRecordStore
  scope: ManagedPiSessionScope
  pack: VerifiedManagedPiPack
  homeRoot: string
  claimKeyId: string
  assertAuthorized: () => void
  now: () => number
}) {
  const { store, pack, now } = options
  const scope = Object.freeze({ ...options.scope })
  const recordId = managedPiExecutionRecordId(scope.sessionId)
  if (
    store.hostId !== 'local' ||
    !isAbsolute(options.homeRoot) ||
    typeof options.assertAuthorized !== 'function' ||
    !options.claimKeyId ||
    options.claimKeyId.length > 512 ||
    !['folder', 'git-worktree'].includes(scope.workspaceKind)
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  const home = join(options.homeRoot, recordId)
  const snapshot = pack.readPack()
  if (!snapshot) {
    throw new Error('hive_agent_pack_unavailable')
  }
  const pin = Object.freeze({
    hiveSessionId: scope.sessionId,
    accountId: scope.accountId,
    deviceId: scope.deviceId,
    runtimeRecordId: scope.runtimeRecordId,
    packRevision: hiveAgentTextPackManifestSchema.parse(snapshot.manifest).packRevision
  })
  const assertScope = () => {
    options.assertAuthorized()
    snapshot.assertCurrent()
    const entry = store.hive.get(scope.sessionId)
    if (
      !entry ||
      entry.deletedAt !== undefined ||
      entry.accountId !== scope.accountId ||
      entry.deviceId !== scope.deviceId ||
      entry.projectScope !== scope.projectScope ||
      entry.aggregate.binding?.providerKind !== 'managed-pi' ||
      entry.aggregate.binding.providerSessionRef !== scope.sessionId ||
      entry.aggregate.binding.runtimeRecordRef !== scope.runtimeRecordId
    ) {
      throw new Error('hive_agent_forbidden')
    }
  }
  assertScope()
  await mkdir(options.homeRoot, { recursive: true, mode: 0o700 })
  await mkdir(home, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  })
  const homeStat = await lstat(home)
  if (
    !homeStat.isDirectory() ||
    homeStat.isSymbolicLink() ||
    (await realpath(home)) !== join(await realpath(options.homeRoot), recordId)
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 })
  assertScope()
  const previous = store.getRecord(recordId)
  if (
    previous &&
    (previous.lease.unreconciled ||
      previous.lease.claimStatus !== 'released' ||
      !isDeepStrictEqual(previous.options, pin))
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
  const operationId = `${now()}-${randomUUID().replaceAll('-', '')}`
  const operation = {
    callerKey: JSON.stringify(['managed-pi-execution', scope.accountId, scope.deviceId]),
    operationId,
    fingerprint: createHash('sha256')
      .update(JSON.stringify([scope, pin, home]))
      .digest('hex')
  }
  const reserved = await store.reserveOwner({
    sessionId: recordId,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: scope.projectScope,
      workspaceKind: scope.workspaceKind
    },
    provider: 'managed-pi',
    accountHome: { variable: 'PI_CODING_AGENT_DIR', path: join(home, 'agent') },
    options: pin,
    expectedFence: previous?.lease.runtimeFence ?? null,
    spawnToken: () => randomUUID(),
    claimKeyId: options.claimKeyId,
    handoffOperationId: operationId,
    probe: { outcome: 'indeterminate', reason: 'this host does not adopt an existing Pi process' },
    operation,
    now: now(),
    validate: assertScope
  })
  if (!['created', 'reserved'].includes(reserved.disposition)) {
    throw new Error('hive_agent_outcome_unknown')
  }
  const fence = reserved.record.lease.runtimeFence
  const spawnToken = reserved.record.lease.reservedSpawnToken!
  let identity: Readonly<AgentSessionProcessIdentity> | undefined
  let exitObserved = false
  const isExactReservation = (record: AgentSessionRecord) =>
    record.provider === 'managed-pi' &&
    record.lease.runtimeFence === fence &&
    record.lease.reservedSpawnToken === spawnToken &&
    isDeepStrictEqual(record.options, pin)
  const assertCurrent = () => {
    assertScope()
    const record = store.getRecord(recordId)
    if (
      exitObserved ||
      !record ||
      !isExactReservation(record) ||
      record.lease.unreconciled ||
      record.lease.leaseDeadlineAt <= now() ||
      !['reserved', 'live'].includes(record.lease.claimStatus) ||
      (record.lease.claimStatus === 'reserved' &&
        (record.lease.handoffStage !== 'new-owner-proving' ||
          record.lease.handoffOperationId !== operationId)) ||
      (record.lease.claimStatus === 'live' && !agentSessionLeaseAdmitsWriter(record.lease))
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
  }
  const assertLive = () => {
    assertCurrent()
    const record = store.getRecord(recordId)!
    if (
      !identity ||
      !agentSessionLeaseAdmitsWriter(record.lease) ||
      !isDeepStrictEqual(record.lease.ownerProcess, identity)
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
  }
  const failed = (exitProof: 'root-exit-observed' | 'processless' | 'unproven') =>
    store.settleFailedAcquisition({
      sessionId: recordId,
      fence,
      spawnToken,
      callerKey: operation.callerKey,
      operationId,
      outcome: { status: 'failed', code: 'hive_agent_capability_unavailable' },
      exitProof,
      now: now()
    })
  const ownership: ManagedPiExecutionOwnership = Object.freeze({
    sessionId: scope.sessionId,
    runtimeRecordId: scope.runtimeRecordId,
    hostId: 'local',
    runtimeFence: fence,
    spawnToken,
    assertCurrent,
    async onIdentity(process: Readonly<AgentSessionProcessIdentity>) {
      assertCurrent()
      identity = Object.freeze({ ...process })
      await store.transitionHandoff(recordId, (record) => {
        assertCurrent()
        return commitAgentSessionProcessIdentity({
          record,
          sessionId: recordId,
          fence,
          process: identity!,
          now: now()
        })
      })
      await store.transitionHandoff(recordId, (record) => {
        assertCurrent()
        return proveAgentSessionOwner({
          record,
          fence,
          now: now(),
          leaseTtlMs: AGENT_SESSION_LEASE_TTL_MS,
          link: {
            linkId: randomUUID(),
            handle: { provider: 'managed-pi', sessionId: scope.sessionId },
            origin: record.providerHandleChain.length ? 'resumed' : 'created',
            mintedAtFence: fence,
            observedAt: now()
          }
        })
      })
      assertLive()
      await store.recordOperationOutcome({
        ...operation,
        outcome: { status: 'succeeded', sessionId: recordId }
      })
    },
    async onExit(receipt: Readonly<{ pid: number | null }>) {
      if (identity && receipt.pid !== identity.pid) {
        throw new Error('hive_agent_outcome_unknown')
      }
      exitObserved = true
      const record = store.getRecord(recordId)
      if (!record || !isExactReservation(record)) {
        return
      }
      if (record.lease.claimStatus === 'reserved') {
        await failed(receipt.pid === null ? 'processless' : 'root-exit-observed')
      } else if (record.lease.claimStatus === 'live') {
        await store.transitionHandoff(recordId, (current, taskExecutions) => {
          if (
            !isExactReservation(current) ||
            !isDeepStrictEqual(current.lease.ownerProcess, identity)
          ) {
            throw new Error('agent_session_checkpoint_stale')
          }
          return releaseAgentSessionOwnerAfterSurfaceClose({
            record: current,
            taskExecutions,
            expectedFence: fence,
            now: now()
          })
        })
      }
    }
  })
  return Object.freeze({
    ownership,
    recordId,
    home,
    fence,
    assertLive,
    async markUnprovenStartup() {
      const record = store.getRecord(recordId)
      if (
        !exitObserved &&
        record &&
        isExactReservation(record) &&
        record.lease.claimStatus === 'reserved'
      ) {
        await failed('unproven')
      }
    }
  })
}

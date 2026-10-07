import { isDeepStrictEqual as same } from 'node:util'
import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  AgentSessionExecutionHostProbeSchema,
  agentSessionExecutionHostWitnessMatchesRecord,
  type AgentSessionExecutionHostWitness
} from '../../shared/agent-session-execution-host-proof'
import {
  TaskSessionSourceReferenceSchema,
  taskSessionSourceReference
} from '../../shared/task-execution/task-structured-binding'
import { runProcess } from '../../shared/child-process/run-process'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { createTaskDockerBoundary } from './task-docker-boundary'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
import { hasTaskSessionBinding } from './task-session-association'

const UNVERIFIABLE: AgentSessionOwnerProbe = { outcome: 'execution-host-unverifiable' }
export const TASK_OWNER_PROBE_BUDGET_MS = 15_000

function boundTask(record: AgentSessionRecord, value: TaskExecutionRecord | null | undefined) {
  const source = TaskSessionSourceReferenceSchema.safeParse(record.taskSource)
  const parsed = TaskExecutionRecordSchema.safeParse(value)
  if (!source.success || !parsed.success) {
    return null
  }
  const task = parsed.data
  const binding = task.structuredBinding
  const identity = task.dockerIdentity
  if (
    !binding ||
    !identity?.containerId ||
    record.provider !== 'codex' ||
    !same(source.data, taskSessionSourceReference(task)) ||
    !same(binding.source, source.data) ||
    binding.sessionId !== record.sessionId ||
    binding.location.executionHostId !== 'local' ||
    !same(binding.location, record.location) ||
    !same(binding.accountHome, record.accountHome)
  ) {
    return null
  }
  const witness: AgentSessionExecutionHostWitness = {
    sessionId: binding.sessionId,
    hostId: 'local',
    source: source.data,
    ownerFence: binding.runtimeFence,
    spawnToken: binding.spawnToken,
    daemonId: identity.daemon.ID,
    containerId: identity.containerId,
    imageId: identity.imageId
  }
  return agentSessionExecutionHostWitnessMatchesRecord(witness, record)
    ? { task, identity, witness }
    : null
}

/** Rechecks the original Task map inside the session store's existing transaction. */
export function taskDockerSessionProbeForRecord(
  record: AgentSessionRecord,
  probe: AgentSessionOwnerProbe,
  taskExecutions: ReadonlyMap<string, TaskExecutionRecord> | undefined
): AgentSessionOwnerProbe {
  if (!Object.hasOwn(record, 'taskSource')) {
    const taskBound = hasTaskSessionBinding(taskExecutions, record.sessionId)
    return taskBound || probe.outcome.startsWith('execution-host-') ? UNVERIFIABLE : probe
  }
  const source = TaskSessionSourceReferenceSchema.safeParse(record.taskSource)
  const bound = source.success
    ? boundTask(record, taskExecutions?.get(taskExecutionRecordKey(source.data)))
    : null
  const parsed = AgentSessionExecutionHostProbeSchema.safeParse(probe)
  return bound &&
    parsed.success &&
    parsed.data.outcome !== 'execution-host-unverifiable' &&
    same(bound.witness, parsed.data.witness)
    ? parsed.data
    : UNVERIFIABLE
}

export function createTaskDockerSessionOwner(options: {
  store: AgentSessionRecordStore
  run?: typeof runProcess
}) {
  const pendingProbes = new Set<string>()
  function sameOwner(current: AgentSessionRecord, record: AgentSessionRecord): boolean {
    return (
      current.sessionId === record.sessionId &&
      current.provider === record.provider &&
      same(current.taskSource, record.taskSource) &&
      same(current.location, record.location) &&
      same(current.accountHome, record.accountHome) &&
      current.lease.runtimeFence === record.lease.runtimeFence &&
      current.lease.reservedSpawnToken === record.lease.reservedSpawnToken &&
      same(current.lease.ownerProcess, record.lease.ownerProcess)
    )
  }
  function resolve(record: AgentSessionRecord) {
    const current = options.store.getRecord(record.sessionId)
    if (!current || !sameOwner(current, record)) {
      return { personal: false, bound: null }
    }
    if (!Object.hasOwn(record, 'taskSource')) {
      return { personal: !options.store.tasks.hasSessionBinding(record.sessionId), bound: null }
    }
    const source = TaskSessionSourceReferenceSchema.safeParse(record.taskSource)
    return {
      personal: false,
      bound: source.success ? boundTask(record, options.store.tasks.get(source.data)) : null
    }
  }
  function classify(record: AgentSessionRecord): 'personal' | 'task' | 'unverifiable' {
    const owned = resolve(record)
    return owned.personal ? 'personal' : owned.bound ? 'task' : 'unverifiable'
  }
  async function observe(
    record: AgentSessionRecord,
    stop: boolean,
    deadline?: number
  ): Promise<AgentSessionOwnerProbe | null> {
    const owned = resolve(record)
    if (owned.personal) {
      return null
    }
    if (!owned.bound) {
      return UNVERIFIABLE
    }
    try {
      const { task, identity, witness } = owned.bound
      const boundary = createTaskDockerBoundary({
        dockerPath: identity.dockerPath,
        endpoint: identity.endpoint,
        imageId: identity.imageId,
        record: task,
        recoveryIdentity: identity,
        run:
          deadline === undefined
            ? options.run
            : async (spec) => {
                const remaining = deadline - performance.now()
                if (remaining <= 0) {
                  throw new Error('Task owner probe budget exhausted')
                }
                const result = await (options.run ?? runProcess)({
                  ...spec,
                  timeoutMs: Math.min(spec.timeoutMs ?? TASK_OWNER_PROBE_BUDGET_MS, remaining)
                })
                if (performance.now() >= deadline) {
                  throw new Error('Task owner probe budget exhausted')
                }
                return result
              },
        assertCurrent: () => {
          throw new Error('recovery cannot prepare a container')
        }
      })
      if (stop && !(await boundary.stop())) {
        return UNVERIFIABLE
      }
      const verdict = await boundary.inspect()
      const after = resolve(record).bound
      if (!after || !same(after.identity, identity) || !same(after.witness, witness)) {
        return UNVERIFIABLE
      }
      return verdict === 'unverifiable'
        ? UNVERIFIABLE
        : { outcome: verdict === 'live' ? 'execution-host-live' : 'execution-host-exited', witness }
    } catch {
      return UNVERIFIABLE
    }
  }
  return {
    classify,
    probe(
      record: AgentSessionRecord,
      roundDeadline = performance.now() + TASK_OWNER_PROBE_BUDGET_MS
    ) {
      const kind = classify(record)
      if (kind === 'personal') {
        return Promise.resolve(null)
      }
      const deadline = Math.min(roundDeadline, performance.now() + TASK_OWNER_PROBE_BUDGET_MS)
      if (
        kind !== 'task' ||
        deadline <= performance.now() ||
        pendingProbes.has(record.sessionId) ||
        pendingProbes.size >= 4
      ) {
        return Promise.resolve(UNVERIFIABLE)
      }
      // A returned timeout cannot free the slot while the actual CLI observation is still pending.
      pendingProbes.add(record.sessionId)
      const attempt = observe(record, false, deadline).then(
        (value) => {
          pendingProbes.delete(record.sessionId)
          return value
        },
        () => {
          pendingProbes.delete(record.sessionId)
          return UNVERIFIABLE
        }
      )
      return withTimeout(attempt, Math.max(0, deadline - performance.now()), UNVERIFIABLE)
    },
    stop: (record: AgentSessionRecord) => observe(record, true)
  }
}

export type TaskDockerSessionOwner = ReturnType<typeof createTaskDockerSessionOwner>

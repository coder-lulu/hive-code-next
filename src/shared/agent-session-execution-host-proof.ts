import { z } from 'zod'
import type { AgentSessionRecord } from './agent-session-record'
import { TaskSessionSourceReferenceSchema } from './task-execution/task-structured-binding'

export const AgentSessionExecutionHostWitnessSchema = z.strictObject({
  sessionId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  hostId: z.literal('local'),
  source: TaskSessionSourceReferenceSchema,
  ownerFence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  spawnToken: z.string().min(1).max(512),
  daemonId: z.string().min(1).max(512),
  containerId: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  imageId: z.string().regex(/^sha256:[0-9a-f]{64}$/)
})
export type AgentSessionExecutionHostWitness = z.infer<
  typeof AgentSessionExecutionHostWitnessSchema
>
export const AgentSessionExecutionHostProbeSchema = z.union([
  z.strictObject({
    outcome: z.literal('execution-host-live'),
    witness: AgentSessionExecutionHostWitnessSchema
  }),
  z.strictObject({
    outcome: z.literal('execution-host-exited'),
    witness: AgentSessionExecutionHostWitnessSchema
  }),
  z.strictObject({ outcome: z.literal('execution-host-unverifiable') })
])
export type AgentSessionExecutionHostProbe = z.infer<typeof AgentSessionExecutionHostProbeSchema>
export const AgentSessionExecutionHostDeathSchema = z
  .strictObject({
    kind: z.literal('execution-host-exit-observed'),
    detail: z.string().min(1).max(512),
    observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ownerFence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    lastProvenAliveAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    witness: AgentSessionExecutionHostWitnessSchema
  })
  .refine(
    (value) =>
      value.ownerFence === value.witness.ownerFence && value.lastProvenAliveAt <= value.observedAt
  )
const ProcessDeathSchema = z
  .object({
    kind: z.enum(['exit-observed', 'pid-absent', 'identity-mismatch']),
    detail: z.string().min(1).max(512),
    observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ownerFence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    lastProvenAliveAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
  })
  .refine(
    (value) => value.lastProvenAliveAt === undefined || value.lastProvenAliveAt <= value.observedAt
  )
export type AgentSessionDeathEvidence =
  | z.infer<typeof AgentSessionExecutionHostDeathSchema>
  | z.infer<typeof ProcessDeathSchema>

export function isAgentSessionDeathEvidence(value: unknown): value is AgentSessionDeathEvidence {
  return (
    AgentSessionExecutionHostDeathSchema.safeParse(value).success ||
    ProcessDeathSchema.safeParse(value).success
  )
}

export function agentSessionExecutionHostWitnessMatchesRecord(
  witnessValue: unknown,
  record: AgentSessionRecord
): boolean {
  const parsed = AgentSessionExecutionHostWitnessSchema.safeParse(witnessValue)
  const source = TaskSessionSourceReferenceSchema.safeParse(record.taskSource)
  if (!parsed.success || !source.success) {
    return false
  }
  const witness = parsed.data
  if (
    record.provider !== 'codex' ||
    record.location.executionHostId !== witness.hostId ||
    record.location.wslDistro !== null ||
    record.lease.sessionId !== record.sessionId ||
    witness.sessionId !== record.sessionId ||
    JSON.stringify(source.data) !== JSON.stringify(witness.source)
  ) {
    return false
  }
  const lease = record.lease
  if (
    lease.runtimeFence === witness.ownerFence &&
    lease.reservedSpawnToken === witness.spawnToken
  ) {
    return (
      lease.ownerProcess === null ||
      (lease.ownerProcess.hostId === witness.hostId &&
        lease.ownerProcess.spawnToken === witness.spawnToken)
    )
  }
  const death = AgentSessionExecutionHostDeathSchema.safeParse(lease.deathEvidence)
  return (
    lease.claimStatus === 'released' &&
    lease.ownerProcess === null &&
    lease.reservedSpawnToken === null &&
    lease.runtimeFence > witness.ownerFence &&
    death.success &&
    JSON.stringify(death.data.witness) === JSON.stringify(witness)
  )
}

export function isAgentSessionExecutionHostProbe(
  value: unknown
): value is AgentSessionExecutionHostProbe {
  return AgentSessionExecutionHostProbeSchema.safeParse(value).success
}

export function agentSessionExecutionHostProbeMatchesRecord(
  value: unknown,
  record: AgentSessionRecord
): boolean {
  const probe = AgentSessionExecutionHostProbeSchema.safeParse(value)
  return (
    probe.success &&
    probe.data.outcome !== 'execution-host-unverifiable' &&
    agentSessionExecutionHostWitnessMatchesRecord(probe.data.witness, record)
  )
}

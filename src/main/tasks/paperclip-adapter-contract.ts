import { z } from 'zod'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import {
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef
} from '../../shared/task-execution/task-execution-primitives'
import type { LocalTaskClient } from './local-task-client'
import type { TaskExecutionObservation } from '../../shared/task-execution/task-execution-observation'

export const HiveRuntimeAdapterConfig = z.strictObject({
  workspaceRef: TaskOpaqueRef,
  profileId: TaskOpaqueRef,
  profileRevision: TaskOpaqueRef
})
export const HiveRuntimeAdapterBinding = z.strictObject({
  bindingRef: TaskOpaqueRef,
  paperclipCompanyId: TaskOpaqueRef,
  paperclipAgentId: TaskOpaqueRef,
  command: TaskExecutionStartSchema,
  commandFingerprint: TaskDigest
})
const Session = z.strictObject({
  bindingRef: TaskOpaqueRef,
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch,
  commandFingerprint: TaskDigest,
  sessionRef: TaskOpaqueRef.nullable()
})
export type HiveRuntimeBinding = z.infer<typeof HiveRuntimeAdapterBinding>
export const HiveRuntimeBindingPurposeSchema = z.enum(['execute', 'recover'])
export type HiveRuntimeBindingPurpose = z.infer<typeof HiveRuntimeBindingPurposeSchema>

/** The adapter-facing subset of the pinned adapter-utils 0.3.1 contract. */
export type PaperclipTaskExecutionContext = {
  runId: string
  agent: { id: string; companyId: string; adapterType: string | null }
  runtime: { taskKey: string | null; sessionParams: Record<string, unknown> | null }
  config: Record<string, unknown>
  signal?: AbortSignal
  onCancellationReady?: () => Promise<void>
  onDispatch?: () => void | Promise<void>
  onLog: (stream: 'stdout' | 'stderr', chunk: string) => Promise<void>
  runtimeCommandSpec?: unknown
  executionTarget?: unknown
  executionTransport?: unknown
  runtimeMcp?: unknown
  runtimeTools?: unknown
  authToken?: string
}
export type PaperclipTaskExecutionResult = {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  errorCode?: string
  errorMessage?: string
  costUsd: null
  usageBasis: null
  billingType: 'unknown'
  sessionParams?: Record<string, unknown>
  sessionDisplayId?: string | null
  resultJson?: Record<string, unknown>
}
export type HiveRuntimeAdapterPorts = {
  client: LocalTaskClient
  resolveBinding: (
    companyId: string,
    runId: string,
    purpose: HiveRuntimeBindingPurpose
  ) => Promise<unknown>
  pollIntervalMs?: number
  waitTimeoutMs?: number
  observationCursor?: number
  onObservation?: (observation: TaskExecutionObservation) => Promise<void>
  assertCurrent?: () => void
}
export type PaperclipEnvironmentTestResult = {
  adapterType: string
  status: 'pass' | 'fail'
  testedAt: string
  checks: { code: string; level: 'info' | 'error'; message: string }[]
}

function readSession(value: unknown) {
  const parsed = Session.safeParse(value)
  return parsed.success ? parsed.data : null
}

// The pinned core adds these after serialize, and invokes deserialize before stripping them.
const paperclipSessionMetadataKeys = new Set([
  'paperclipAiCredentialIdentity',
  '__paperclipConfiguredModel',
  '__paperclipConfigFingerprint',
  '__paperclipConfigFingerprintVersion',
  '__paperclipConfigCategories',
  '__paperclipConfigCategoryFingerprints'
])

function deserializeSession(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return readSession(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !paperclipSessionMetadataKeys.has(key))
    )
  )
}

export const hiveRuntimeSessionCodec = {
  deserialize: deserializeSession,
  serialize: readSession,
  getDisplayId: (value: Record<string, unknown> | null) =>
    deserializeSession(value)?.sessionRef ?? null
}

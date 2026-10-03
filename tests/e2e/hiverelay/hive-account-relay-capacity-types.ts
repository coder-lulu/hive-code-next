import type { HiveRuntimeCloudIdentity } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudAuthorization } from '../../../src/main/hive-account/hive-account-service'

export type RuntimeFixture = {
  identity: HiveRuntimeCloudIdentity
  resourceVersion: number
  presenceSession: HiveRuntimeCloudAuthorization & {
    cloudSessionId: string
  }
  tuple: {
    runtimeRecordId: string
    runtimeInstanceId: string
    authorityGeneration: number
    fencingEpoch: number
    leaseEpoch: number
  }
}

export type CloudStatus = {
  heartbeatBurst?: Record<string, unknown>
  authorityCount: number
  currentAssignments: number
  activeSessions: number
  runtimes: {
    runtimeRecordId: string
    resourceVersion: number
    lease?: { heartbeatLeaseId: string; leaseEpoch: number; bootId: string }
    assignments: {
      assignmentId: string
      cellId: string
      status: string
      terminalReason: string | null
      terminalAt: string | null
      assignmentEpoch: number
      controlGeneration: number
    }[]
    sessions: {
      sessionId: string
      runtimeSessionId: string
      status: string
      terminalReason: string | null
      terminalAt: string | null
    }[]
  }[]
  cells: { cellId: string; assignments: number; activeSessions: number }[]
  workers?: {
    errors: string[]
    revocationRuns: number
    expiryRuns: number
    revocationsProjected: number
    sessionsExpired: number
  }
  heartbeat?: { concurrencyLimit: number; concurrencyRejected: number }
  privateOps?: {
    transport: {
      runs: number
      httpAttempts: number
      receipts: {
        commandId: string
        cellId: string
        targetIncarnationId: string
        result: string
        assignmentId: string
        observedAt: string
      }[]
      errors: string[]
    }
    deliveries: { assignmentId: string; attempts: number; completedAt: string | null }[]
  }
}

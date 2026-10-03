import type { ExecutionHostId } from './execution-host'

/** Durable organization metadata for a session that still runs in its original workspace. */
export type SessionProjectAssignment = {
  projectId: string
  projectIdentityKey: string
  projectGroupId: string | null
  executionHostId: ExecutionHostId
  assignedAt: number
}

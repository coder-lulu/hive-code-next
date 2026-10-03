import { z } from 'zod'
import {
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../protocol-version'
import { TaskExecutionStartSchema } from './task-execution-command'
import {
  boundedTaskCollection,
  TASK_ENFORCEMENT_CAPABILITY,
  TASK_EXECUTION_CAPABILITY,
  TASK_RESOURCE_SNAPSHOT_CAPABILITY,
  TASK_STOP_PROOF_CAPABILITY,
  TASK_WORKSPACE_CLAIM_CAPABILITY,
  TaskCoverage,
  TaskRuntimeIdentity,
  TaskOpaqueRef
} from './task-execution-primitives'

export const TaskExecutionCapabilitiesSchema = z.strictObject({
  ...TaskRuntimeIdentity,
  kind: z.literal('execution.capabilities'),
  host: z.enum(['native', 'wsl', 'ssh']),
  capabilities: boundedTaskCollection(TaskOpaqueRef, 128),
  resourceCoverage: boundedTaskCollection(TaskCoverage, 2),
  manifestVersions: boundedTaskCollection(TaskOpaqueRef, 16),
  resolverVersions: boundedTaskCollection(TaskOpaqueRef, 16)
})

export function taskExecutionCapabilityRefusal(commandValue: unknown, hostValue: unknown) {
  const parsedCommand = TaskExecutionStartSchema.safeParse(commandValue)
  if (!parsedCommand.success) {
    return 'task_command_invalid'
  }
  const parsedHost = TaskExecutionCapabilitiesSchema.safeParse(hostValue)
  if (!parsedHost.success) {
    return 'task_capability_unavailable'
  }
  const command = parsedCommand.data
  const host = parsedHost.data
  if (command.runtimeRecordId !== host.runtimeRecordId) {
    return 'task_runtime_mismatch'
  }
  if (command.ownershipEpoch !== host.ownershipEpoch) {
    return 'task_ownership_epoch_mismatch'
  }
  if (
    command.ownerScope.kind === 'teamSpace' &&
    command.executionPolicy.trustMode !== 'enforced_autonomous'
  ) {
    return 'task_enforcement_required'
  }
  const required = [
    TASK_EXECUTION_CAPABILITY,
    AGENT_LAUNCH_RUNTIME_CAPABILITY,
    AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
    TASK_WORKSPACE_CLAIM_CAPABILITY,
    TASK_STOP_PROOF_CAPABILITY,
    ...command.requiredCapabilities
  ]
  if (command.executionPolicy.trustMode === 'enforced_autonomous') {
    required.push(TASK_ENFORCEMENT_CAPABILITY)
  }
  if ('resourceSnapshotRef' in command) {
    required.push(TASK_RESOURCE_SNAPSHOT_CAPABILITY)
    const covered =
      host.resourceCoverage.includes(command.requiredCoverage) ||
      (command.requiredCoverage === 'managed_only' &&
        host.resourceCoverage.includes('effective_set_verified'))
    if (!covered) {
      return 'task_coverage_unavailable'
    }
    if (!host.manifestVersions.includes(command.manifestVersion)) {
      return 'task_manifest_unsupported'
    }
    if (!host.resolverVersions.includes(command.resolverVersion)) {
      return 'task_resolver_unsupported'
    }
  }
  return required.every((capability) => host.capabilities.includes(capability))
    ? null
    : 'task_capability_unavailable'
}

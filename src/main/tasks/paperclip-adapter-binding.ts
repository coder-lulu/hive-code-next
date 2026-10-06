import {
  HiveRuntimeAdapterBinding,
  HiveRuntimeAdapterConfig,
  hiveRuntimeSessionCodec,
  type HiveRuntimeAdapterPorts,
  type HiveRuntimeBindingPurpose,
  type PaperclipTaskExecutionContext
} from './paperclip-adapter-contract'
import { TaskExecutionError } from './task-execution-error'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'

/** The binding resolver must read a committed facade binding; adapter config never creates grants. */
export async function requirePaperclipTaskBinding(
  context: PaperclipTaskExecutionContext,
  ports: HiveRuntimeAdapterPorts,
  purpose: HiveRuntimeBindingPurpose
) {
  const config = HiveRuntimeAdapterConfig.safeParse(context.config)
  if (
    context.agent.adapterType !== 'hive_runtime' ||
    !config.success ||
    !context.signal ||
    !context.onCancellationReady ||
    !context.onDispatch ||
    !context.runtime.taskKey ||
    context.runtimeCommandSpec != null ||
    context.executionTarget != null ||
    context.executionTransport != null ||
    context.runtimeMcp != null ||
    context.runtimeTools != null ||
    context.authToken != null
  ) {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  }
  const binding = HiveRuntimeAdapterBinding.safeParse(
    await ports.resolveBinding(context.agent.companyId, context.runId, purpose)
  )
  if (
    !binding.success ||
    binding.data.paperclipCompanyId !== context.agent.companyId ||
    binding.data.paperclipAgentId !== context.agent.id ||
    binding.data.command.task.runId !== context.runId ||
    binding.data.command.task.taskId !== context.runtime.taskKey ||
    binding.data.command.workspaceRef !== config.data.workspaceRef ||
    binding.data.command.profileId !== config.data.profileId ||
    binding.data.command.profileRevision !== config.data.profileRevision ||
    binding.data.command.ownerScope.kind !== 'personalTenant' ||
    (binding.data.command.executionPolicy.trustMode !== 'trusted_personal_preview' &&
      !isTaskDockerEnforcementPolicy(binding.data.command.executionPolicy))
  ) {
    throw new TaskExecutionError('FORBIDDEN')
  }
  if (context.runtime.sessionParams !== null) {
    const session = hiveRuntimeSessionCodec.deserialize(context.runtime.sessionParams)
    if (
      !session ||
      session.bindingRef !== binding.data.bindingRef ||
      session.executionId !== binding.data.command.executionId ||
      session.executionEpoch !== binding.data.command.executionEpoch ||
      session.runtimeRecordId !== binding.data.command.runtimeRecordId ||
      session.ownershipEpoch !== binding.data.command.ownershipEpoch ||
      session.commandFingerprint !== binding.data.commandFingerprint
    ) {
      throw new TaskExecutionError('IDEMPOTENCY_CONFLICT')
    }
  }
  return binding.data
}

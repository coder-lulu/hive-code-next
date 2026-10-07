import { z } from 'zod'
import { readNodeFileWithinLimit } from '../../shared/node-bounded-file-reader'
import { LocalTaskClient } from './local-task-client'
import { executePaperclipTask } from './paperclip-adapter-execute'
import {
  hiveRuntimeSessionCodec,
  type HiveRuntimeAdapterPorts,
  type HiveRuntimeBindingPurpose,
  type PaperclipTaskExecutionContext,
  type PaperclipEnvironmentTestResult
} from './paperclip-adapter-contract'
import { paperclipTaskErrorResult } from './paperclip-adapter-result'
import { TaskExecutionError } from './task-execution-error'
import type { LocalTaskClientOptions } from './local-task-http-client'
import {
  TASK_EXECUTION_CAPABILITY,
  TASK_STOP_PROOF_CAPABILITY,
  TASK_WORKSPACE_CLAIM_CAPABILITY
} from '../../shared/task-execution/task-execution-primitives'
import {
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'

const Bridge = z.strictObject({ baseUrl: z.string().max(2048), secret: z.string().length(43) })

export async function createLocalTaskAdapterClient(headers?: LocalTaskClientOptions['headers']) {
  const path = process.env.HIVE_TASK_TRANSPORT_DESCRIPTOR
  if (!path) {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  }
  const contents = await readNodeFileWithinLimit(path, 4096)
  if (!contents.stats.isFile()) {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  }
  const parsed = Bridge.safeParse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents.buffer))
  )
  if (!parsed.success) {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  }
  return new LocalTaskClient({ ...parsed.data, headers })
}

async function localPorts(): Promise<HiveRuntimeAdapterPorts> {
  const client = await createLocalTaskAdapterClient()
  return {
    client,
    resolveBinding: (companyId, runId, purpose) => client.binding(companyId, runId, purpose)
  }
}

/** Factory signature used by the pinned Paperclip external plugin loader. */
export function createServerAdapter(
  resolvePorts: () => Promise<HiveRuntimeAdapterPorts> = localPorts
) {
  const run = async (
    context: PaperclipTaskExecutionContext,
    purpose: HiveRuntimeBindingPurpose
  ) => {
    try {
      return await executePaperclipTask(context, await resolvePorts(), purpose)
    } catch (error) {
      return paperclipTaskErrorResult(
        error instanceof TaskExecutionError ? error.code : 'CAPABILITY_UNAVAILABLE',
        null,
        purpose === 'recover'
      )
    }
  }
  return {
    type: 'hive_runtime',
    sessionCodec: hiveRuntimeSessionCodec,
    async execute(context: PaperclipTaskExecutionContext) {
      return run(context, 'execute')
    },
    async recover(context: PaperclipTaskExecutionContext) {
      return run(context, 'recover')
    },
    async testEnvironment(_context: unknown): Promise<PaperclipEnvironmentTestResult> {
      const testedAt = new Date().toISOString()
      try {
        const capabilities = await (await resolvePorts()).client.capabilities()
        const required = [
          TASK_EXECUTION_CAPABILITY,
          TASK_WORKSPACE_CLAIM_CAPABILITY,
          TASK_STOP_PROOF_CAPABILITY,
          AGENT_LAUNCH_RUNTIME_CAPABILITY,
          AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
        ]
        const available =
          capabilities.host === 'native' &&
          required.every((item) => capabilities.capabilities.includes(item))
        return {
          adapterType: 'hive_runtime',
          status: available ? 'pass' : 'fail',
          testedAt,
          checks: [
            {
              code: available ? 'HIVE_RUNTIME_READY' : 'CAPABILITY_UNAVAILABLE',
              level: available ? 'info' : 'error',
              message: available
                ? 'Authenticated local task protocol is available.'
                : 'Required Hive task capabilities are unavailable.'
            }
          ]
        }
      } catch {
        return {
          adapterType: 'hive_runtime',
          status: 'fail',
          testedAt,
          checks: [
            {
              code: 'CAPABILITY_UNAVAILABLE',
              level: 'error',
              message: 'Authenticated Hive task bridge is unavailable.'
            }
          ]
        }
      }
    }
  }
}

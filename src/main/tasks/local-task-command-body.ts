import type { IncomingMessage } from 'node:http'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import { assertJsonTextStructureWithinLimits } from '../../shared/json-text-structure-limit'
import {
  TASK_NATIVE_DEFAULT_MAX_BYTES,
  TASK_WORKFLOW_NATIVE_MAX_BYTES,
  TASK_WORKFLOW_NATIVE_MAX_STRUCTURAL_TOKENS,
  TASK_NATIVE_MAX_NESTING_DEPTH
} from '../../shared/task-execution/task-native-transport-limits'
import { TaskExecutionError } from './task-execution-error'

const tooLarge = () => Object.assign(new TaskExecutionError('INVALID_REQUEST'), { status: 413 })

export async function readTaskCommand(request: IncomingMessage, workflowStart = false) {
  const maximum = workflowStart ? TASK_WORKFLOW_NATIVE_MAX_BYTES : TASK_NATIVE_DEFAULT_MAX_BYTES
  if (Number(request.headers['content-length']) > maximum) {
    throw tooLarge()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maximum) {
      request.resume()
      throw tooLarge()
    }
    chunks.push(bytes)
  }
  let command: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
    assertJsonTextStructureWithinLimits(text, {
      nestingDepth: TASK_NATIVE_MAX_NESTING_DEPTH,
      structuralTokens: workflowStart ? TASK_WORKFLOW_NATIVE_MAX_STRUCTURAL_TOKENS : 16_384
    })
    command = JSON.parse(text)
  } catch {
    if (size > TASK_NATIVE_DEFAULT_MAX_BYTES) {
      throw tooLarge()
    }
    throw new TaskExecutionError('INVALID_REQUEST')
  }
  if (size > TASK_NATIVE_DEFAULT_MAX_BYTES) {
    const parsed = TaskExecutionStartSchema.safeParse(command)
    if (!workflowStart || !parsed.success || !parsed.data.workflowContext) {
      throw tooLarge()
    }
    return parsed.data
  }
  return command
}

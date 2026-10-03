import { z } from 'zod'
import { TaskExecutionCancelSchema, TaskExecutionStartSchema } from './task-execution-command'
import { TaskExecutionCapabilitiesSchema } from './task-execution-capabilities'
import { TaskRefSchema } from './task-execution-primitives'
import {
  TaskExecutionObserveSchema,
  TaskExecutionReconcileSchema,
  TaskExecutionObservationSchema
} from './task-execution-observation'
import {
  TaskExecutionAcceptedSchema,
  TaskExecutionEventSchema,
  TaskExecutionResultSchema,
  TaskResourceActivationSchema,
  TaskResourcePreparationSchema,
  TaskUsageFactSchema
} from './task-execution-receipts'

export const TaskExecutionSchemas = {
  TaskRef: TaskRefSchema,
  ExecutionCommand: TaskExecutionStartSchema,
  CancelCommand: TaskExecutionCancelSchema,
  ObserveCommand: TaskExecutionObserveSchema,
  ReconcileCommand: TaskExecutionReconcileSchema,
  ExecutionObservation: TaskExecutionObservationSchema,
  AcceptedReceipt: TaskExecutionAcceptedSchema,
  ExecutionEvent: TaskExecutionEventSchema,
  ExecutionResult: TaskExecutionResultSchema,
  Capability: TaskExecutionCapabilitiesSchema,
  ResourcePreparationReceipt: TaskResourcePreparationSchema,
  ResourceActivationReceipt: TaskResourceActivationSchema,
  UsageFact: TaskUsageFactSchema
}

export function taskExecutionJsonSchema() {
  const definitions = Object.fromEntries(
    Object.entries(TaskExecutionSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { target: 'draft-2020-12' })
    ])
  )
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:hive:task-execution:1',
    $defs: definitions,
    oneOf: Object.keys(definitions)
      .filter((name) => name !== 'TaskRef')
      .map((name) => ({ $ref: `#/$defs/${name}` }))
  }
}

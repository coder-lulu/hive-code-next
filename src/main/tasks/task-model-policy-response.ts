import type { createPolicyItems, PolicyCall } from './task-model-policy-items'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'
import {
  array,
  boolean,
  deny,
  error,
  headers,
  id,
  integer,
  object,
  oneOf,
  text,
  usage
} from './task-model-policy-json'

export function createTaskModelResponsePolicy(
  model: string,
  item: ReturnType<typeof createPolicyItems>['item']
) {
  return (
    value: unknown,
    next: Map<string, PolicyCall>,
    learned: Set<string>,
    completed: boolean
  ): void => {
    try {
      const r = object(
        value,
        'id object created_at status model output usage usage_metadata end_turn error incomplete_details background user metadata headers',
        'id'
      )
      id(r.id)
      if (
        (r.object !== undefined && r.object !== 'response') ||
        (r.model !== undefined && r.model !== model)
      ) {
        deny(
          'RESPONSE_IDENTITY',
          r.object !== undefined && r.object !== 'response' ? 'other' : 'model'
        )
      }
      if (r.created_at !== undefined) {
        integer(r.created_at)
      }
      if (r.status !== undefined) {
        oneOf(r.status, 'in_progress completed incomplete failed')
      }
      if (
        completed &&
        ((r.status !== undefined && r.status !== 'completed') ||
          r.error != null ||
          r.incomplete_details != null)
      ) {
        deny('RESPONSE_TERMINAL_STATE')
      }
      if (r.end_turn != null) {
        boolean(r.end_turn)
      }
      if (
        (r.background !== undefined && r.background !== false) ||
        (r.user !== undefined && r.user !== null)
      ) {
        deny('RESPONSE_METADATA')
      }
      if (r.metadata !== undefined) {
        try {
          object(r.metadata, '')
        } catch (error) {
          addTaskModelPolicyLocation(error, 'response_metadata')
          throw error
        }
      }
      if (r.headers !== undefined) {
        headers(r.headers, model)
      }
      if (r.output !== undefined) {
        array(r.output).forEach((v) => item(v, next, learned, true))
      }
      if (r.usage != null) {
        usage(r.usage)
      }
      if (r.usage_metadata != null) {
        deny('USAGE_METADATA_UNSUPPORTED', 'usage_metadata')
      }
      if (r.error != null) {
        error(r.error)
      }
      if (r.incomplete_details != null) {
        try {
          const d = object(r.incomplete_details, 'reason', 'reason')
          text(d.reason)
        } catch (error) {
          addTaskModelPolicyLocation(error, 'incomplete_details')
          throw error
        }
      }
    } catch (error) {
      addTaskModelPolicyLocation(error, 'response')
      throw error
    }
  }
}

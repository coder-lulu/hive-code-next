import { array, deny, object, text } from './task-model-policy-json'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'

/** Pinned native notification data; never model-selection or effect authority. */
export function validateTaskModelSafetyBuffering(value: unknown, metadata = false): void {
  if (!metadata && (value === null || value === false)) {
    return
  }
  try {
    const signal = object(
      value,
      metadata ? 'type use_cases reasons retry_model' : 'use_cases reasons retry_model',
      metadata ? 'type use_cases reasons' : 'use_cases reasons'
    )
    if (metadata && signal.type !== 'safety_buffering') {
      deny('SAFETY_BUFFERING_UNSUPPORTED', 'safety_buffering')
    }
    for (const field of ['use_cases', 'reasons']) {
      const values = array(signal[field])
      if (values.length > 32) {
        deny('ARRAY', 'safety_buffering')
      }
      for (const value of values) {
        const label = text(value, 128)
        if (
          Buffer.byteLength(label) > 128 ||
          [...label].some((character) => {
            const code = character.charCodeAt(0)
            return code < 32 || (code >= 127 && code <= 159)
          })
        ) {
          deny('STRING', 'safety_buffering')
        }
      }
    }
    if (signal.retry_model !== undefined && signal.retry_model !== null) {
      deny('SAFETY_BUFFERING_UNSUPPORTED', 'safety_buffering')
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'safety_buffering')
    throw error
  }
}

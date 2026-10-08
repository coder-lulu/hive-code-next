import { deny, object } from './task-model-policy-json'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'

// Hosted tools are disabled; only their exact zero-use counters are admissible.
export function validateTaskModelInactiveToolUsage(value: unknown): void {
  try {
    const tools = object(value, 'image_gen web_search', 'image_gen web_search')
    const imageFields =
      'input_tokens output_tokens total_tokens input_tokens_details output_tokens_details'
    const image = object(tools.image_gen, imageFields, imageFields)
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
      if (image[key] !== 0) {
        deny('RESPONSE_CONFIGURATION', 'tool_usage')
      }
    }
    for (const key of ['input_tokens_details', 'output_tokens_details']) {
      const detail = object(image[key], 'image_tokens text_tokens', 'image_tokens text_tokens')
      if (detail.image_tokens !== 0 || detail.text_tokens !== 0) {
        deny('RESPONSE_CONFIGURATION', 'tool_usage')
      }
    }
    const web = object(tools.web_search, 'num_requests', 'num_requests')
    if (web.num_requests !== 0) {
      deny('RESPONSE_CONFIGURATION', 'tool_usage')
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'response_tool_usage')
    throw error
  }
}

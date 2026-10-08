import { array, deny, text, type PolicyObject } from './task-model-policy-json'

export function taskModelEventMetadataFields(event: PolicyObject, kind: string): string {
  let fields = ''
  if (kind.endsWith('.delta')) {
    fields += 'obfuscation '
    if (Object.hasOwn(event, 'obfuscation')) {
      text(event.obfuscation, 512)
    }
  }
  if (kind === 'response.output_text.delta' || kind === 'response.output_text.done') {
    fields += 'logprobs '
    if (Object.hasOwn(event, 'logprobs') && array(event.logprobs).length !== 0) {
      deny('CONTENT_METADATA_UNSUPPORTED', 'logprobs')
    }
  }
  return fields
}

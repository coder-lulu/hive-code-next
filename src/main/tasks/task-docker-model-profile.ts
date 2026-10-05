import { createHash } from 'node:crypto'
import pin from '../../../integration/paperclip/runtime/codex-package.json'
import catalog from '../../../integration/paperclip/runtime/catalog-provenance.json'
import inventory from '../../../integration/paperclip/runtime/model-tools.json'
import type { TaskModelProfile } from './task-model-policy'

/** Fixed policy data grants no Task authority or Docker image qualification. */
export function taskDockerModelProfile(): TaskModelProfile {
  if (
    inventory.codexVersion !== pin.version ||
    inventory.packageSha256 !== pin.sha256 ||
    inventory.binarySha256 !== pin.binarySha256 ||
    inventory.model !== catalog.model ||
    inventory.catalogSha256 !== catalog.catalogSha256 ||
    createHash('sha256').update(JSON.stringify(inventory.tools)).digest('hex') !==
      inventory.toolsSha256
  ) {
    throw new Error('TASK_MODEL_PROFILE_UNAVAILABLE')
  }
  return {
    model: inventory.model,
    responsesLite: true,
    approvedTools: structuredClone(inventory.tools),
    reasoningEfforts: ['low']
  }
}

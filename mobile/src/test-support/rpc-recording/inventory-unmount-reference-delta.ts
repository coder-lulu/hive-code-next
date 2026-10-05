import { createHash } from 'node:crypto'
import { GOLDEN_FORMAT_VERSION, type GoldenRecording } from './golden-recording'
import { canonicalJson } from './golden-value-pool'
import { captureArguments, type RecordedValue } from './recording-values'

export const INVENTORY_UNMOUNT_REFERENCE_ID = 'lifecycle-inventory-lifecycle'
const ORIGINAL_TRACE_SHA256 = '10aaebb1d5aa49ac465736ac5b114ae8d84bceb92a154ed5fd2858645dbf2865'
const CHANGED_CHECKPOINTS = new Set([
  'inventory-lifecycle.unmount-before-1:settled',
  'inventory-lifecycle.unmount-before-1:remounted'
])

function lateInventoryRequest(value: RecordedValue): Record<string, RecordedValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The frozen inventory request is not an object')
  }
  return value
}

/** #24792 closes admission after unmount; only the immutable expected trace may be adapted. */
export function inventoryUnmountExpectedReference(original: GoldenRecording): GoldenRecording {
  const digest = createHash('sha256').update(JSON.stringify(original.recording)).digest('hex')
  if (
    original.goldenFormatVersion !== GOLDEN_FORMAT_VERSION ||
    original.operation !== 'workspace.file-inventory' ||
    original.family !== 'legacy-inventory' ||
    original.namedDeltas.length !== 0 ||
    original.recording.scenario !== INVENTORY_UNMOUNT_REFERENCE_ID ||
    digest !== ORIGINAL_TRACE_SHA256
  ) {
    throw new Error('The frozen inventory reference differs from its approved original')
  }
  const expected = structuredClone(original)
  let changed = 0
  for (const checkpoint of expected.recording.checkpoints) {
    if (!CHANGED_CHECKPOINTS.has(checkpoint.id)) {
      continue
    }
    const { sender, payloads } = checkpoint.observation
    if (
      !Array.isArray(sender) ||
      sender.length !== 2 ||
      !Array.isArray(payloads) ||
      payloads.length !== 2
    ) {
      throw new Error('The frozen inventory checkpoint has a different request count')
    }
    const request = lateInventoryRequest(sender[1]!)
    const payload = lateInventoryRequest(payloads[1]!)
    if (
      request.name !== 'files.list#1' ||
      request.ordinal !== 3 ||
      canonicalJson(request.args) !==
        canonicalJson(captureArguments(['files.list', { worktree: 'id:A' }])) ||
      payload.name !== 'files.list#1' ||
      payload.ordinal !== 4 ||
      payload.json !==
        JSON.stringify({
          id: 'frame-2',
          deviceToken: 'recording-device',
          method: 'files.list',
          params: { worktree: 'id:A' }
        })
    ) {
      throw new Error('The frozen late inventory sender and payload do not match')
    }
    checkpoint.observation.sender = sender.slice(0, 1)
    checkpoint.observation.payloads = payloads.slice(0, 1)
    changed++
  }
  if (changed !== CHANGED_CHECKPOINTS.size) {
    throw new Error('The approved inventory source delta must change exactly two checkpoints')
  }
  return expected
}

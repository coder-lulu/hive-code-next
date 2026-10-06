import { describe, expect, it } from 'vitest'
import { WorkflowNativeDeliverySchema } from './workflow-native-delivery'
import { workflowNativeDeliveryFixture as delivery } from './workflow-native-delivery.test-fixture'

describe('private native delivery metadata boundaries', () => {
  it('represents original artifact membership without permission fields', () => {
    expect(WorkflowNativeDeliverySchema.parse(delivery())).toEqual(delivery())
  })
  it.each(['actor', 'authorized', 'stopProof', 'passed'])(
    'rejects a model-supplied %s claim',
    (key) => {
      expect(WorkflowNativeDeliverySchema.safeParse({ ...delivery(), [key]: true }).success).toBe(
        false
      )
    }
  )
  it('keeps an empty diagnostic delivery possible without an approval decision', () => {
    expect(WorkflowNativeDeliverySchema.safeParse({ ...delivery(), artifacts: [] }).success).toBe(
      true
    )
  })
  it('rejects a renamed artifact even when its version is unchanged', () => {
    const value = delivery()
    value.artifacts[0].name = 'review.json'
    expect(WorkflowNativeDeliverySchema.safeParse(value).success).toBe(false)
  })
  it('rejects a foreign artifact revision', () => {
    const value = delivery()
    value.artifacts[0] = {
      ...value.artifacts[0],
      version: { ...value.artifacts[0].version, digest: '0'.repeat(64) }
    }
    expect(WorkflowNativeDeliverySchema.safeParse(value).success).toBe(false)
  })
  it('rejects duplicate membership instead of selecting an arbitrary report', () => {
    const value = delivery()
    value.artifacts.push(value.artifacts[0])
    expect(WorkflowNativeDeliverySchema.safeParse(value).success).toBe(false)
  })
  it('does not replace the original unavailable command reason', () => {
    const value = delivery()
    value.commands.reason = 'record_not_stopped'
    expect(WorkflowNativeDeliverySchema.safeParse(value).success).toBe(false)
  })
  it('bounds report content to two immutable artifacts', () => {
    const value = delivery()
    value.artifacts.push(value.artifacts[0], value.artifacts[0])
    expect(WorkflowNativeDeliverySchema.safeParse(value).success).toBe(false)
  })
})

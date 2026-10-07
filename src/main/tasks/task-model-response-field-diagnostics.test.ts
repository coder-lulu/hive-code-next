import { describe, expect, it, vi } from 'vitest'
import { taskFailure, taskFailureSummary } from './task-failure-diagnostic'
import { publicTaskModelResponseFields } from './task-model-response-field-diagnostics.test-fixture'
import { object } from './task-model-policy-json'
import {
  addTaskModelPolicyLocation,
  taskModelPolicyRefusal,
  taskModelRefusedPolicyKey,
  taskModelStreamDiagnostic
} from './task-model-stream-failure'

const refused = (error: unknown) => taskFailure(error, 'stream', 'TASK_MODEL_STREAM_REFUSED', 200)

describe('finite public response field diagnostic labels', () => {
  it('rejects empty-name properties under empty schemas while retaining valid empty objects', () => {
    const empty = {}
    expect(object(empty, '')).toBe(empty)
    expect(() => object({ '': 1 }, '')).toThrow('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD')
    expect(() => object({ instructions: 'synthetic' }, '')).toThrow(
      'TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'
    )
    expect(() => object({ '': 1 }, 'id')).toThrow('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD')
    expect(() => object({}, 'id', 'id')).toThrow('TASK_MODEL_POLICY_REFUSED:REQUIRED_FIELD')
    const known = { id: 'synthetic' }
    expect(object(known, 'id', 'id')).toBe(known)
  })
  it.each(publicTaskModelResponseFields)('labels only the exact public %s field name', (key) => {
    expect(taskModelRefusedPolicyKey(key)).toBe(key)
    const original = taskModelPolicyRefusal('UNKNOWN_FIELD', taskModelRefusedPolicyKey(key))
    addTaskModelPolicyLocation(original, 'response')
    const first = refused(original)
    expect(first.diagnostic).toMatchObject({
      streamReason: 'policy',
      policyReason: 'UNKNOWN_FIELD',
      policyLocation: 'response',
      policyKey: key
    })
    expect(taskFailure(first, 'response', 'TASK_MODEL_UPSTREAM_UNAVAILABLE', 500)).toBe(first)
    for (const failure of [
      taskFailure(original, 'request', 'TASK_MODEL_REQUEST_REFUSED', 200),
      taskFailure(original, 'stream', 'TASK_MODEL_STREAM_REFUSED'),
      taskFailure(original, 'stream', 'TASK_MODEL_STREAM_REFUSED', 429)
    ]) {
      expect(failure.diagnostic).not.toHaveProperty('streamReason')
      expect(failure.diagnostic).not.toHaveProperty('policyKey')
    }
  })

  it.each([
    'Authorization',
    'ChatGPT-Account-Id',
    'https://private.invalid/token-secret',
    '/private/token-secret',
    'token-secret',
    'billing',
    'Instructions',
    'instructions ',
    'instructions.token-secret'
  ])('reduces an unsupported field name to other without retaining it', (key) => {
    expect(taskModelRefusedPolicyKey(key)).toBe('other')
    const error = taskModelPolicyRefusal('UNKNOWN_FIELD', taskModelRefusedPolicyKey(key))
    addTaskModelPolicyLocation(error, 'response')
    expect(refused(error).diagnostic.policyKey).toBe('other')
    expect(taskFailureSummary('model', refused(error))).not.toContain(key)
  })

  it('does not coerce boxed, getter or proxy keys into finite labels', () => {
    const coercion = vi.fn(() => 'instructions')
    const getter = Object.defineProperty({}, 'toString', { get: coercion })
    const proxy = new Proxy(
      {},
      {
        get: coercion,
        getPrototypeOf: () => {
          throw new Error('Unexpected proxy access')
        }
      }
    )
    for (const key of [Object('instructions'), getter, proxy, undefined, null, 1]) {
      expect(Reflect.apply(taskModelRefusedPolicyKey, undefined, [key])).toBe('other')
      const error = Reflect.apply(taskModelPolicyRefusal, undefined, ['UNKNOWN_FIELD', key])
      addTaskModelPolicyLocation(error, 'response')
      expect(refused(error).diagnostic).not.toHaveProperty('policyKey')
    }
    expect(coercion).not.toHaveBeenCalled()
  })

  it('does not transfer original producer proof through spoofed properties or proxy identity', () => {
    const original = taskModelPolicyRefusal(
      'UNKNOWN_FIELD',
      taskModelRefusedPolicyKey('instructions')
    )
    addTaskModelPolicyLocation(original, 'response')
    const getter = vi.fn(() => 'instructions')
    const spoof = Object.assign(new Error('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'), {
      streamReason: 'policy',
      policyReason: 'UNKNOWN_FIELD',
      policyLocation: 'response',
      policyKey: 'instructions'
    })
    for (const error of [
      spoof,
      Object.create(original),
      Object.defineProperty({}, 'policyKey', { get: getter }),
      Object('instructions'),
      new Proxy(original, {
        get: getter,
        getPrototypeOf: () => {
          throw new Error('Unexpected proxy access')
        }
      })
    ]) {
      addTaskModelPolicyLocation(error, 'response')
      expect(taskModelStreamDiagnostic(error)).toBeUndefined()
      expect(refused(error).diagnostic).not.toHaveProperty('streamReason')
      expect(refused(error).diagnostic).not.toHaveProperty('policyKey')
    }
    expect(getter).not.toHaveBeenCalled()
    expect(refused(original).diagnostic.policyKey).toBe('instructions')
  })

  it.each(['response_metadata', 'incomplete_details'])(
    'keeps only the first real %s location and rejects nested location spoofing',
    (location) => {
      const original = taskModelPolicyRefusal(
        'UNKNOWN_FIELD',
        taskModelRefusedPolicyKey('instructions')
      )
      const getter = vi.fn(() => location)
      for (const value of [
        Object(location),
        Object.defineProperty({}, 'location', { get: getter }),
        new Proxy(
          {},
          {
            get: getter,
            getPrototypeOf: () => {
              throw new Error('Unexpected proxy access')
            }
          }
        )
      ]) {
        Reflect.apply(addTaskModelPolicyLocation, undefined, [original, value])
      }
      expect(taskModelStreamDiagnostic(original)).not.toHaveProperty('policyLocation')
      const fake = Object.assign(new Error('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'), {
        policyLocation: location,
        policyKey: 'instructions',
        metadata: { policyLocation: location, policyKey: 'instructions' }
      })
      Reflect.apply(addTaskModelPolicyLocation, undefined, [fake, location])
      expect(refused(fake).diagnostic).not.toHaveProperty('policyLocation')
      Reflect.apply(addTaskModelPolicyLocation, undefined, [original, location])
      addTaskModelPolicyLocation(original, 'response')
      expect(refused(original).diagnostic.policyLocation).toBe(location)
      expect(getter).not.toHaveBeenCalled()
    }
  )
})

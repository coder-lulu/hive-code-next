import { describe, expect, it, vi } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { modelRequestBody } from './task-model-broker.test-fixture'
import { controlledTaskModelResponse } from './task-model-response-envelope.test-fixture'
import {
  documentedResponseDiagnosticKeys,
  responseFieldProvenanceCases
} from './task-model-response-field-provenance.test-fixture'
import { validateTaskModelResponseConfiguration } from './task-model-response-configuration'
import { taskFailure, taskFailureSummary } from './task-failure-diagnostic'
import {
  taskModelStreamDiagnostic,
  taskModelPolicyRefusal,
  taskModelRefusedPolicyKey,
  addTaskModelPolicyLocation
} from './task-model-stream-failure'

const safe = (error: unknown) => taskFailure(error, 'stream', 'TASK_MODEL_STREAM_REFUSED', 200)
function reader() {
  const profile = taskDockerModelProfile()
  return createTaskModelPolicy(profile).responseEvent(
    JSON.stringify({
      ...modelRequestBody,
      instructions: '',
      tools: undefined,
      parallel_tool_calls: false,
      input: [{ type: 'additional_tools', role: 'developer', tools: profile.approvedTools }],
      reasoning: { effort: 'low', context: 'all_turns' }
    })
  )
}
function caught(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('Expected original policy refusal')
}

describe('finite innermost response producer provenance', () => {
  it.each(responseFieldProvenanceCases)(
    'discriminates $label without changing refusal',
    ({ response, location, reason, key }) => {
      const original = caught(() =>
        reader()(
          JSON.stringify({
            type: 'response.created',
            response: controlledTaskModelResponse(response)
          })
        )
      )
      expect(taskModelStreamDiagnostic(original)).toMatchObject({
        streamReason: 'policy',
        policyReason: reason,
        policyLocation: location,
        ...(key ? { policyKey: key } : {})
      })
      const first = safe(original)
      expect(taskFailure(first, 'response', 'TASK_MODEL_UPSTREAM_UNAVAILABLE', 500)).toBe(first)
      expect(taskFailureSummary('model', first)).not.toMatch(
        /private-key|body-token-secret|unapproved/
      )
    }
  )

  it.each(documentedResponseDiagnosticKeys)(
    'labels the exact documented %s root refusal without admitting it',
    (key) => {
      const original = caught(() =>
        reader()(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'resp-fixture', [key]: 'synthetic' }
          })
        )
      )
      expect(safe(original).diagnostic).toMatchObject({
        policyReason: 'UNKNOWN_FIELD',
        policyLocation: 'response',
        policyKey: key
      })
    }
  )

  it.each([
    {
      location: 'response_access_programs',
      response: (error: unknown) => ({
        access_programs: {
          get cyber() {
            throw error
          }
        }
      })
    },
    {
      location: 'response_reasoning',
      response: (error: unknown) => ({
        reasoning: {
          get mode() {
            throw error
          }
        }
      })
    },
    {
      location: 'response_text',
      response: (error: unknown) => ({
        text: {
          get verbosity() {
            throw error
          }
        }
      })
    },
    {
      location: 'response_text_format',
      response: (error: unknown) => ({
        text: {
          format: {
            get type() {
              throw error
            }
          }
        }
      })
    }
  ])(
    'rethrows the same $location producer error and keeps its first inner annotation',
    ({ location, response }) => {
      const original = taskModelPolicyRefusal('ENUM', taskModelRefusedPolicyKey('cyber'))
      const actual = caught(() => validateTaskModelResponseConfiguration(response(original), false))
      expect(actual).toBe(original)
      addTaskModelPolicyLocation(actual, 'response')
      addTaskModelPolicyLocation(actual, 'event')
      expect(safe(actual).diagnostic).toMatchObject({
        policyReason: 'ENUM',
        policyLocation: location,
        policyKey: 'cyber'
      })
    }
  )

  it('does not promote forged properties, inherited proof, getters or proxy identity', () => {
    const getter = vi.fn(() => 'response_text_format')
    const real = taskModelPolicyRefusal('ENUM')
    const fake = Object.defineProperty(
      Object.assign(new Error('TASK_MODEL_POLICY_REFUSED:ENUM'), {
        policyReason: 'ENUM',
        policyLocation: 'response_text_format'
      }),
      'policyKey',
      { get: getter }
    )
    for (const error of [
      fake,
      Object.create(real),
      new Proxy(real, {
        getPrototypeOf() {
          throw new Error('Unexpected prototype access')
        }
      })
    ]) {
      const actual = caught(() =>
        validateTaskModelResponseConfiguration(
          {
            text: {
              format: {
                get type() {
                  throw error
                }
              }
            }
          },
          false
        )
      )
      expect(actual).toBe(error)
      expect(taskModelStreamDiagnostic(actual)).toBeUndefined()
      expect(safe(actual).diagnostic).not.toHaveProperty('policyLocation')
    }
    expect(getter).not.toHaveBeenCalled()
    for (const key of [Object('cyber'), Object.defineProperty({}, 'toString', { get: getter })]) {
      expect(Reflect.apply(taskModelRefusedPolicyKey, undefined, [key])).toBe('other')
    }
    expect(getter).not.toHaveBeenCalled()
  })
})

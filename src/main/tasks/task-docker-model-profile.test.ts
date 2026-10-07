import { describe, expect, it } from 'vitest'
import inventory from '../../../integration/paperclip/runtime/model-tools.json'
import { createTaskModelPolicy } from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'

const request = (tools: readonly unknown[], model = 'gpt-6.1-sol', effort = 'low') =>
  JSON.stringify({
    model,
    input: [
      { type: 'additional_tools', role: 'developer', tools },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Edit the workspace.' }]
      }
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort, context: 'all_turns' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content']
  })

describe('pinned Docker model inventory', () => {
  it('accepts the real pinned binary definitions through the production policy', () => {
    const profile = taskDockerModelProfile()
    const policy = createTaskModelPolicy(profile)
    expect(() => policy.request(request(profile.approvedTools))).not.toThrow()
    expect(profile.responsesLite).toBe(true)
    expect(profile.approvedTools).toEqual(inventory.tools)
  })

  it('refuses changed tool descriptions even when their names and schemas remain the same', () => {
    const profile = taskDockerModelProfile()
    const altered = structuredClone(inventory.tools)
    altered[0].tools[0].description += '\nUnapproved additional capability.'
    const policy = createTaskModelPolicy(profile)
    expect(() => policy.request(request(altered))).toThrow('TASK_MODEL_POLICY_REFUSED')
    expect(() => policy.request(request(profile.approvedTools))).not.toThrow()
  })

  it('pins the delivered model and reasoning effort', () => {
    const profile = taskDockerModelProfile()
    const policy = createTaskModelPolicy(profile)
    expect(() => policy.request(request(profile.approvedTools, 'other-model'))).toThrow(
      'TASK_MODEL_POLICY_REFUSED'
    )
    expect(() => policy.request(request(profile.approvedTools, profile.model, 'ultra'))).toThrow(
      'TASK_MODEL_POLICY_REFUSED'
    )
  })
})

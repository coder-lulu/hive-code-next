import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { modelRequestBody } from './task-model-broker.test-fixture'
import { controlledTaskModelResponse } from './task-model-response-envelope.test-fixture'

function definitions(deferLoading?: false) {
  const profile = taskDockerModelProfile()
  const tools: {
    type: string
    name: string
    description: string
    tools: Record<string, unknown>[]
  }[] = JSON.parse(JSON.stringify(profile.approvedTools))
  if (deferLoading !== undefined) {
    for (const tool of tools[0].tools) {
      tool.defer_loading = deferLoading
    }
    profile.approvedTools = tools
  }
  const request = {
    ...modelRequestBody,
    instructions: '',
    parallel_tool_calls: false,
    tools: undefined,
    input: [{ type: 'additional_tools', role: 'developer', tools }],
    reasoning: { effort: 'low', context: 'all_turns' }
  }
  return { tools, reader: createTaskModelPolicy(profile).responseEvent(JSON.stringify(request)) }
}

function event(tools: unknown) {
  return JSON.stringify({
    type: 'response.created',
    response: controlledTaskModelResponse({ tools })
  })
}

describe('effective response tool inventory', () => {
  it('retains admitted false defer_loading in the reader inventory', () => {
    const { tools, reader } = definitions(false)
    expect(() => reader(event(tools))).not.toThrow()
    delete tools[0].tools[0].defer_loading
    expect(() => reader(event(tools))).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })
  it('accepts reordered named definitions and only a null output schema', () => {
    const { tools, reader } = definitions()
    tools[0].tools.reverse()
    const wait = tools[0].tools.find((t) => t.name === 'wait')!
    wait.output_schema = null
    expect(() => reader(event(tools))).not.toThrow()
  })

  it.each([
    'subset',
    'duplicate',
    'name',
    'parameters',
    'grammar',
    'description',
    'output',
    'unknown'
  ])('rejects a changed %s inventory', (change) => {
    const { tools, reader } = definitions()
    const wait = tools[0].tools.find((t) => t.name === 'wait')!
    const exec = tools[0].tools.find((t) => t.name === 'exec')!
    if (change === 'subset') {
      tools[0].tools.pop()
    }
    if (change === 'duplicate') {
      tools[0].tools.push(wait)
    }
    if (change === 'name') {
      wait.name = 'unapproved'
    }
    if (change === 'parameters') {
      wait.parameters = { type: 'object' }
    }
    if (change === 'grammar') {
      exec.format = { type: 'text' }
    }
    if (change === 'description') {
      exec.description = 'changed instruction'
    }
    if (change === 'output') {
      wait.output_schema = {}
    }
    if (change === 'unknown') {
      wait.deferred = false
    }
    expect(() => reader(event(tools))).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })
})

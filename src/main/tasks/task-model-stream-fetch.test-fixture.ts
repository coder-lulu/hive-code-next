import { once } from 'node:events'
import { createServer } from 'node:http'
import { vi } from 'vitest'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { modelStartParams } from './task-model-broker.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

export async function createTaskModelStreamFetchFixture(
  directory: string,
  body: string | Buffer,
  options: { holdOpen?: boolean; headers?: Record<string, string> } = {}
) {
  const server = createServer((_request, reply) => {
    reply.writeHead(200, options.headers)
    if (options.holdOpen) {
      reply.write(body)
    } else {
      reply.end(body)
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local test endpoint unavailable')
  }
  const owner = await createTaskModelDispatchFixture(directory)
  const providerAccountId = 'offline-provider'
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const actual = await fetch(`http://127.0.0.1:${address.port}`, { signal: init?.signal })
    return new Response(actual.body, { status: actual.status, headers: actual.headers })
  })
  const channel = createTaskCodexModelChannel({
    store: owner.store,
    binding: owner.binding,
    account: {
      accountId: 'offline-managed-row',
      codexHome: owner.binding.accountHome.path,
      providerAccountId,
      assertCurrent: owner.validate,
      assertMetadataCurrent: owner.validate
    },
    deadline: TASK_TEST_NOW + 120_000,
    assertCurrent: () => {
      owner.validate()
      owner.store.tasks.assertStructuredBindingCurrent(owner.binding)
    },
    readAuth: async () => ({
      Authorization: 'Bearer offline_synthetic',
      'ChatGPT-Account-Id': providerAccountId
    }),
    request
  })
  const profile = taskDockerModelProfile()
  const params = modelStartParams({
    model: profile.model,
    input: [
      { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Synthetic request' }]
      }
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content']
  })
  return { owner, channel, params, request, server }
}

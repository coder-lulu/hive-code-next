import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexAppServerConnection } from '../codex/codex-app-server-connection'
import { createTaskDockerModelChannelPort } from './task-docker-model-channel'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { createTaskDockerModelRpc } from './task-docker-model-rpc'
import {
  modelBrokerFixture,
  modelEvent,
  modelResponse,
  modelStartParams
} from './task-model-broker.test-fixture'
import { TASK_MODEL_RPC_NEXT, TASK_MODEL_RPC_START } from './task-model-channel-protocol'

const closed: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closed.splice(0)) {
    await close()
  }
})

describe('bounded private transport of validated model streams', () => {
  it.each(['coalesced', 'per-event', 'seven-byte', 'sixteen-requests'])(
    'delivers the same long reply with %s upstream reads',
    async (mode) => {
      const events = [
        modelEvent('response.created', { response: { id: 'resp-stream' } }),
        ...Array.from({ length: 1400 }, () =>
          modelEvent('response.output_text.delta', { delta: 'x' })
        ),
        modelEvent('response.completed', { response: { id: 'resp-stream' } })
      ]
      const chunks =
        mode === 'coalesced'
          ? [events.join('')]
          : mode === 'per-event' || mode === 'sixteen-requests'
            ? events
            : events.flatMap((event) =>
                Array.from({ length: Math.ceil(event.length / 7) }, (_, index) =>
                  event.slice(index * 7, (index + 1) * 7)
                )
              )
      const responses: ReturnType<typeof modelResponse>[] = []
      const profile = taskDockerModelProfile()
      const f = modelBrokerFixture({ profile })
      f.request.mockImplementation(async () => {
        const response = modelResponse(chunks)
        responses.push(response)
        return response.reply
      })
      const failed = vi.fn()
      const rpc = createTaskDockerModelRpc({
        write: async (line) => {
          port.handle(JSON.parse(line))
        },
        onFailure: failed
      })
      const raw: CodexAppServerConnection = {
        pid: undefined,
        closed: false,
        request: async () => ({}),
        notify: () => undefined,
        respond: (id, result) => {
          rpc.handleResponse({ id, result })
        },
        respondWithError: (id, code, message) => {
          rpc.handleResponse({ id, error: { code, message } })
        },
        close: async () => true
      }
      const port = createTaskDockerModelChannelPort({
        channel: f.channel,
        connection: () => raw,
        assertCurrent: () => undefined,
        onFailure: () => {
          failed()
          void rpc.close()
        }
      })
      closed.push(
        () => rpc.close(),
        () => port.close()
      )
      const body = {
        model: profile.model,
        instructions: '',
        input: [
          { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write code' }] }
        ],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { effort: 'low' },
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content']
      }
      const requests = mode === 'sixteen-requests' ? 16 : 1
      for (let request = 0; request < requests; request++) {
        const params = modelStartParams(body)
        await rpc.request(TASK_MODEL_RPC_START, params)
        const delivered: Buffer[] = []
        let done = false
        for (let sequence = 0; sequence < events.length + 10; sequence++) {
          const value = await rpc.request(TASK_MODEL_RPC_NEXT, {
            requestId: params.requestId,
            sequence
          })
          if (
            typeof value !== 'object' ||
            value === null ||
            !('bodyBase64' in value) ||
            typeof value.bodyBase64 !== 'string' ||
            !('done' in value)
          ) {
            throw new Error('Invalid fixture model reply')
          }
          delivered.push(Buffer.from(value.bodyBase64, 'base64'))
          if (value.done === true) {
            done = true
            break
          }
        }
        expect(done).toBe(true)
        expect(Buffer.concat(delivered).toString()).toBe(events.join(''))
      }
      expect(failed).not.toHaveBeenCalled()
      expect(f.reserveDispatch).toHaveBeenCalledTimes(requests)
      expect(f.request).toHaveBeenCalledTimes(requests)
      for (const response of responses) {
        expect(response.cancel).toHaveBeenCalledTimes(1)
      }
    }
  )
})

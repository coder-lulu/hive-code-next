import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { NATIVE_CHAT_METHODS } from './native-chat'

it('reads the host-owned Pi tool transcript over remote RPC and rejects a revoked reader', async () => {
  const { SessionManager } =
    await import('../../../../../runtime/native-pi/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js')
  const directory = await mkdtemp(join(tmpdir(), 'hive-remote-native-'))
  try {
    const session = SessionManager.create(directory, join(directory, 'sessions'))
    session.appendMessage({ role: 'user', content: 'read file', timestamp: 1 })
    session.appendMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }],
      api: 'openai-completions',
      provider: 'hivecode',
      model: 'fixture-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'toolUse',
      timestamp: 2
    })
    session.appendMessage({
      role: 'toolResult',
      toolCallId: 'read-1',
      toolName: 'read',
      content: [{ type: 'text', text: 'host-owned file contents' }],
      isError: false,
      timestamp: 3
    })
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'execution-host' } as OrcaRuntimeService,
      methods: NATIVE_CHAT_METHODS
    })
    let current = true
    const options = {
      authenticatedAccountRuntimeSessionId: 'activated-session',
      authorizeRequest: () => current,
      clientKind: 'runtime' as const
    }
    const request = {
      id: 'read',
      authToken: '',
      method: 'nativeChat.readSession',
      params: {
        agent: 'hivecode',
        sessionId: session.getSessionId(),
        transcriptPath: session.getSessionFile()
      }
    }
    const replies: string[] = []
    await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), options)
    const result = JSON.parse(replies[0]!)
    expect(result).toMatchObject({ ok: true, _meta: { runtimeId: 'execution-host' } })
    expect(result.result.messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
      'tool'
    ])
    expect(result.result.messages[2].blocks[0]).toMatchObject({
      type: 'tool-result',
      output: 'host-owned file contents'
    })
    current = false
    const denied = await dispatcher.dispatch(request, options)
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(JSON.stringify(denied)).not.toContain('host-owned file contents')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

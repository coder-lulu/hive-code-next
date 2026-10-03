import type { NativeChatApi } from '../../../../preload/api-types'
import { parseRuntimeNativeChatReadSessionResult } from '@/components/native-chat/native-chat-runtime-contract'
import { createRuntimeNativeChatTransport } from '@/components/native-chat/native-chat-session-transport'
import { translate } from '@/i18n/i18n'
import { callRuntimeResult } from './web-runtime-calls'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

export function createWebNativeChatApi(): NativeChatApi {
  return {
    readSession: async (agent, sessionId, limit, transcriptPath) =>
      parseRuntimeNativeChatReadSessionResult(
        await callRuntimeResult<unknown>('nativeChat.readSession', {
          agent,
          sessionId,
          limit,
          transcriptPath
        })
      ),
    subscribe: (args, onFrame) => {
      // No paired runtime yet: return a no-op teardown so the chat view mounts cleanly; only the not-paired case is swallowed.
      const environment = requireActiveEnvironmentOrNull()
      if (!environment) {
        onFrame({
          type: 'snapshot',
          messages: [],
          hasMore: false,
          error: translate(
            'components.native-chat.state.pairHost',
            'Pair a host to view agent chat history.'
          )
        })
        return () => {}
      }
      return createRuntimeNativeChatTransport(environment.id).subscribe(args, onFrame)
    }
  }
}

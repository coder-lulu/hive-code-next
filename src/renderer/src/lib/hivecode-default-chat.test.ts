import { describe, expect, it } from 'vitest'
import { decideInitialAgentTabViewMode } from './native-chat-initial-view-mode'
import { canToggleNativeChat } from '../components/native-chat/native-chat-availability'
import { nativeChatRequiresLocalTranscript } from '../../../shared/native-chat-agent-support'

describe('HiveCode chat on the owning remote Host', () => {
  it('opens chat with experimental settings disabled and no local transcript access', () => {
    expect(
      decideInitialAgentTabViewMode({
        agent: 'hivecode',
        experimentalNativeChat: false,
        openAgentTabsInChatByDefault: false,
        nativeChatTranscriptIsLocalReadable: false
      })
    ).toBe('chat')
    expect(nativeChatRequiresLocalTranscript('hivecode')).toBe(false)
    expect(nativeChatRequiresLocalTranscript('omp')).toBe(true)
  })

  it.each([undefined, 'pi', 'hivecode'] as const)(
    'allows the Hive launch with %s live identity',
    (detectedAgent) => {
      expect(
        canToggleNativeChat({
          contentType: 'terminal',
          launchAgent: 'hivecode',
          detectedAgent,
          experimentalNativeChatEnabled: false,
          nativeChatTranscriptIsLocalReadable: false
        })
      ).toBe(true)
    }
  )

  it('keeps external agents and a changed foreground agent behind their own setting', () => {
    for (const detectedAgent of ['codex', 'omp'] as const) {
      expect(
        canToggleNativeChat({
          contentType: 'terminal',
          launchAgent: 'hivecode',
          detectedAgent,
          experimentalNativeChatEnabled: false
        })
      ).toBe(false)
    }
    expect(canToggleNativeChat({ contentType: 'terminal', launchAgent: 'pi' })).toBe(false)
  })
})

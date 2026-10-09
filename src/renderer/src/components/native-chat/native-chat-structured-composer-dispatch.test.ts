import { expect, it, vi } from 'vitest'
import { dispatchNativeChatStructuredComposerText } from './native-chat-structured-composer-dispatch'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

it.each([true, false])(
  'waits for async admission before reporting accepted=%s',
  async (accepted) => {
    let finish!: (value: boolean) => void
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const transport = {
      send,
      dispatchCommand: async () => ({ handled: false })
    } as unknown as NativeChatStructuredComposerTransport
    const settled = vi.fn()
    const result = dispatchNativeChatStructuredComposerText(transport, 'task').then(settled)
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    expect(settled).not.toHaveBeenCalled()
    finish(accepted)
    await result
    expect(settled).toHaveBeenCalledWith({ accepted, error: null, revealsTranscript: accepted })
  }
)

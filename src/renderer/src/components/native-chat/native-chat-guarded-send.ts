import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { AGENT_TUI_CLEAR_INPUT_MAX } from '../../../../shared/agent-tui-input-clear'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { enqueueNativeChatPtySend } from './native-chat-pty-send-queue'
import { wrapTerminalBracketedPasteText } from '../terminal-pane/terminal-bracketed-paste'
import type { NativeChatSendHandle, NativeChatSendOptions } from './native-chat-runtime-send'

export function sendGuardedNativeChatMessage(
  settings: Parameters<typeof sendRuntimePtyInputVerified>[0],
  ptyId: string,
  text: string,
  options: NativeChatSendOptions
): NativeChatSendHandle {
  const controller = new AbortController()
  let complete: (accepted: boolean) => void = () => {}
  const accepted = new Promise<boolean>((resolve) => {
    complete = resolve
  })
  const handle = enqueueNativeChatPtySend(
    ptyId,
    NATIVE_CHAT_SUBMIT_DELAY_MS,
    ({ isCancelled, delay, markSubmitted }) => {
      const write = async (data: string) =>
        !isCancelled() &&
        sendRuntimePtyInputVerified(settings, ptyId, data, 'driving', {
          requireAgentStatus: 'sendable',
          signal: controller.signal
        })
      const finish = (delivered: boolean) => {
        complete(delivered)
        if (!delivered && !isCancelled()) {
          options.onRejected?.()
        }
        markSubmitted()
      }
      void (async () => {
        if (!(await write(options.clearInput ?? '\x15'))) {
          return finish(false)
        }
        if (options.confirmCleared) {
          await new Promise<void>((resolve) => setTimeout(resolve, 140))
          if (!options.confirmCleared() && !(await write(AGENT_TUI_CLEAR_INPUT_MAX))) {
            return finish(false)
          }
        }
        if (!(await write(wrapTerminalBracketedPasteText(text)))) {
          return finish(false)
        }
        delay(NATIVE_CHAT_SUBMIT_DELAY_MS, () => {
          void write('\r').then(finish, () => finish(false))
        })
      })().catch(() => finish(false))
    }
  )
  const cancel = handle.cancel
  handle.cancel = () => {
    controller.abort()
    cancel()
    complete(false)
  }
  return { ...handle, accepted }
}

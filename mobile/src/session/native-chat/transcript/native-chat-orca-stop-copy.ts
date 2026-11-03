import type { NativeChatOrcaStopSay } from '../../../../../src/shared/native-chat/native-chat-orca-stop-words'
import type { Translate } from '../../../i18n/mobile-i18n'

export function nativeChatOrcaStopSay(t: Translate): NativeChatOrcaStopSay {
  return (id, machine) => {
    const copy = {
      update: () =>
        t(
          'chat.orcaStop.update',
          'HiveCode on {{machine}} restarted for an update while this response was in progress.',
          { machine }
        ),
      quit: () =>
        t(
          'chat.orcaStop.quit',
          'HiveCode on {{machine}} was closed while this response was in progress.',
          { machine }
        ),
      crash: () =>
        t(
          'chat.orcaStop.crash',
          'HiveCode on {{machine}} stopped unexpectedly while this response was in progress.',
          { machine }
        ),
      remote: () =>
        t(
          'chat.orcaStop.remote',
          'HiveCode on {{machine}} stopped while this response was in progress.',
          { machine }
        ),
      canContinue: () => t('chat.orcaStop.canContinue', 'You can continue in this conversation.'),
      unnamedServer: () => t('chat.orcaStop.unnamedServer', 'the remote server')
    }
    return copy[id]()
  }
}

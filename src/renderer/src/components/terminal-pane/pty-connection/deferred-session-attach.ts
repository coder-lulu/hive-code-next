import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { runDeferredSessionReattachChoice } from './deferred-session-reattach-choice'
import { connectUnservedSshPaneTarget } from './unserved-ssh-pane-connect'

export function runDeferredSessionAttach(session: ConnectPanePtySession): void {
  if (session.obsoleteSshPtyBinding) {
    session.reportError(
      'This saved SSH terminal has no current Runtime owner. Open a new terminal after connecting the host.'
    )
    return
  }
  if (session.unservedSshTargetId) {
    connectUnservedSshPaneTarget(session, session.unservedSshTargetId)
    return
  }
  runDeferredSessionReattachChoice(session)
}

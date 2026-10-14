import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
const calls = vi.hoisted(() => ({ reattach: vi.fn(), connect: vi.fn() }))
vi.mock('./deferred-session-reattach-choice', () => ({
  runDeferredSessionReattachChoice: calls.reattach
}))
vi.mock('./unserved-ssh-pane-connect', () => ({ connectUnservedSshPaneTarget: calls.connect }))
import { runDeferredSessionAttach } from './deferred-session-attach'
describe('current Runtime terminal attachment', () => {
  beforeEach(() => vi.clearAllMocks())
  it('reports unavailable for a saved legacy SSH binding without spawning or reattaching', () => {
    const reportError = vi.fn()
    const session = {
      obsoleteSshPtyBinding: true,
      unservedSshTargetId: 'saved-host',
      reportError
    } as unknown as ConnectPanePtySession
    runDeferredSessionAttach(session)
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('no current Runtime owner'))
    expect(calls.connect).not.toHaveBeenCalled()
    expect(calls.reattach).not.toHaveBeenCalled()
  })
  it('connects a new unserved SSH target through its current Runtime host', () => {
    const session = { unservedSshTargetId: 'host' } as unknown as ConnectPanePtySession
    runDeferredSessionAttach(session)
    expect(calls.connect).toHaveBeenCalledWith(session, 'host')
    expect(calls.reattach).not.toHaveBeenCalled()
  })
  it('uses the current owner attachment choice for normal terminals', () => {
    const session = {} as ConnectPanePtySession
    runDeferredSessionAttach(session)
    expect(calls.reattach).toHaveBeenCalledWith(session)
    expect(calls.connect).not.toHaveBeenCalled()
  })
})

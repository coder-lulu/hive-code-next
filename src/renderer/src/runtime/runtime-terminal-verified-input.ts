import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { resolvePaneKeyForPtyId } from './runtime-terminal-pane-owner'
import type { RuntimeTerminalResolvePane, RuntimeTerminalSend } from '../../../shared/runtime-types'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'
import { isTerminalInputTooLargeWithDeferredMeasurement } from '../../../shared/terminal-input'
import { readTerminalSendAcknowledgment } from '../../../shared/terminal-send-acknowledgment'
import { classifyTerminalProcessInspectionFailure } from '../../../shared/terminal-process-inspection'
import { callRuntimeRpc } from './runtime-rpc-client'
import { getRemoteRuntimePtyOwner } from './runtime-terminal-stream'
import { recordRuntimeTerminalInputForPtyId } from './runtime-terminal-input-recording'

const DESKTOP_RUNTIME_CLIENT = { id: 'orca-desktop', type: 'desktop' } as const

/**
 * True means accepted, false means refusal. `requireWriteSettlement` asks the local provider or a
 * current host for its acknowledgment; a lost one rejects.
 */
export async function sendRuntimePtyInputVerified(
  ptyId: string,
  data: string,
  inputKind: TerminalInputKind,
  options?: { requireAgentStatus?: 'sendable'; requireWriteSettlement?: true; signal?: AbortSignal }
): Promise<boolean> {
  if (options?.signal?.aborted) {
    return false
  }
  const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(data)
  if (typeof tooLarge === 'boolean' ? tooLarge : await tooLarge) {
    return false
  }
  const owner = getRemoteRuntimePtyOwner(ptyId)
  if (!owner && !options?.requireAgentStatus) {
    if (options?.requireWriteSettlement) {
      // Why: an answer that dismisses its card must not fall back to an unacknowledged write.
      const accepted = await window.api.pty.writeAccepted(ptyId, data, inputKind, {
        requireWriteSettlement: true
      })
      if (accepted) {
        recordRuntimeTerminalInputForPtyId(ptyId)
      }
      return accepted
    }
    const accepted = await window.api.pty.writeAccepted(ptyId, data, inputKind)
    if (!accepted) {
      window.api.pty.write(ptyId, data, inputKind)
      // SSH/local fallback writes are fire-and-forget; boolean advances UX while hook telemetry proves actual turns.
      recordRuntimeTerminalInputForPtyId(ptyId)
      return true
    }
    recordRuntimeTerminalInputForPtyId(ptyId)
    return accepted
  }

  const target: RuntimeClientTarget = owner?.target ?? { kind: 'local' }
  let terminal = owner?.terminal ?? null
  try {
    if (!owner) {
      const paneKey = resolvePaneKeyForPtyId(useAppStore.getState().terminalLayoutsByTabId, ptyId)
      if (!paneKey) {
        return false
      }
      const resolved = await callRuntimeRpc<{ terminal: RuntimeTerminalResolvePane }>(
        target,
        'terminal.resolvePane',
        { paneKey },
        { timeoutMs: 15_000, signal: options?.signal }
      )
      if (
        !resolved.terminal.connected ||
        !resolved.terminal.handle ||
        resolved.terminal.ptyId !== ptyId ||
        resolvePaneKeyForPtyId(useAppStore.getState().terminalLayoutsByTabId, ptyId) !== paneKey
      ) {
        return false
      }
      terminal = resolved.terminal.handle
    }
    if (options?.signal?.aborted) {
      return false
    }
    const result = await callRuntimeRpc<{ send: RuntimeTerminalSend }>(
      target,
      'terminal.send',
      {
        terminal,
        text: data,
        client: DESKTOP_RUNTIME_CLIENT,
        ...(options?.requireAgentStatus ? { requireAgentStatus: options.requireAgentStatus } : {}),
        ...(options?.requireWriteSettlement ? { requireWriteSettlement: true } : {})
      },
      { timeoutMs: 15_000, ...(options?.signal ? { signal: options.signal } : {}) }
    )
    if (result.send.accepted === true) {
      recordRuntimeTerminalInputForPtyId(ptyId)
    }
    const acknowledgment = readTerminalSendAcknowledgment(result)
    if (acknowledgment === 'unverifiable' && !options?.requireAgentStatus) {
      throw new Error('PTY write acknowledgment unavailable')
    }
    return acknowledgment === 'accepted'
  } catch (error) {
    if (
      options?.requireAgentStatus ||
      classifyTerminalProcessInspectionFailure(error) === 'terminal_gone'
    ) {
      return false
    }
    throw error
  }
}

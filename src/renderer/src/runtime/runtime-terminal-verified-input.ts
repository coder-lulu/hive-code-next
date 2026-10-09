import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { RuntimeTerminalResolvePane, RuntimeTerminalSend } from '../../../shared/runtime-types'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'
import { isTerminalInputTooLargeWithDeferredMeasurement } from '../../../shared/terminal-input'
import { readTerminalSendAcknowledgment } from '../../../shared/terminal-send-acknowledgment'
import { classifyTerminalProcessInspectionFailure } from '../../../shared/terminal-process-inspection'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import {
  getRemoteRuntimePtyEnvironmentId,
  getRemoteRuntimeTerminalHandle
} from './runtime-terminal-stream'
import { recordRuntimeTerminalInputForPtyId } from './runtime-terminal-input-recording'

const DESKTOP_RUNTIME_CLIENT = { id: 'orca-desktop', type: 'desktop' } as const

import { useAppStore } from '@/store'
import { resolvePaneKeyForPtyId } from './runtime-terminal-pane-owner'

export async function sendRuntimePtyInputVerified(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
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
  const ownerEnvironmentId = getRemoteRuntimePtyEnvironmentId(ptyId)
  let target = ownerEnvironmentId
    ? ({ kind: 'environment', environmentId: ownerEnvironmentId } as const)
    : getActiveRuntimeTarget(settings)
  let terminal = getRemoteRuntimeTerminalHandle(ptyId)
  const local = target.kind !== 'environment' || !terminal
  if (local && !options?.requireAgentStatus) {
    if (options?.requireWriteSettlement) {
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
    }
    recordRuntimeTerminalInputForPtyId(ptyId)
    return true
  }
  try {
    if (local) {
      target = { kind: 'local' }
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
    const acknowledgment = readTerminalSendAcknowledgment(result)
    if (acknowledgment === 'accepted') {
      recordRuntimeTerminalInputForPtyId(ptyId)
      return true
    }
    if (acknowledgment === 'unverifiable' && !options?.requireAgentStatus) {
      throw new Error('PTY write acknowledgment unavailable')
    }
    return false
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

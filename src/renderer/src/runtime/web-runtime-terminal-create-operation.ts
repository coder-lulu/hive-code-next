import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RuntimeMobileSessionCreateTerminalResult } from '../../../shared/runtime-types'
import type {
  RuntimeCreateAgentSessionResult,
  RuntimeEnsureAgentSessionResult
} from '../../../shared/agent-session-host-authority'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import { useAppStore } from '../store'
import {
  createAgentSessionCreateOperation,
  withAgentSessionCreateOperationId
} from './agent-session-create-operation'
import { runRemoteAgentSessionLaunch } from './remote-agent-session-launch'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { resolveWebRuntimeSessionEnvironmentId } from './web-runtime-session-workspace-routing'
import { recordWebSessionFocusIntent } from './web-session-focus-intent'
import {
  forgetWebSessionTerminalPlacement,
  recordWebSessionTerminalPlacement,
  webTerminalPlacementParentTabId
} from './web-session-terminal-placement'
import { toHostSessionTabId } from './web-terminal-surface-id'
import {
  registerWebRuntimeAgentLaunchConfig,
  resolveWebRuntimeAgentHostAuthorityCapabilities
} from './web-runtime-agent-launch-config'
import {
  captureRuntimeEnvironmentCall,
  captureWebSessionIntentOwner,
  isWebRuntimeSessionActive,
  matchesWebSessionIntentOwner
} from './web-runtime-session-environment'
import { refreshWebRuntimeSessionTabsSnapshot } from './web-runtime-session-snapshot'
import type {
  CreatedAgentTerminalIdentity,
  CreatedWebRuntimeSessionTerminal,
  CreateWebRuntimeSessionTerminalArgs
} from './web-runtime-session-types'
import {
  readActiveWorkspaceSelection,
  restoreActiveWorkspaceSelection,
  selectWebRuntimeSessionWorktree,
  type WebRuntimeSessionWorkspaceSelectionRollback
} from './web-runtime-session-workspace-selection'
import { createdTerminalLeafId } from './web-runtime-terminal-identity'
import {
  reportWebRuntimeTerminalCreateFailure,
  disconnectedWebRuntimeTerminalCreateOutcome
} from './web-runtime-terminal-create-outcome'
import { settleWebRuntimeTerminalPlacement } from './web-runtime-terminal-placement-settlement'

export async function createWebRuntimeSessionTerminalResult(
  args: CreateWebRuntimeSessionTerminalArgs
): Promise<CreatedWebRuntimeSessionTerminal> {
  const environmentId = resolveWebRuntimeSessionEnvironmentId(
    args.environmentId,
    useAppStore.getState().settings?.activeRuntimeEnvironmentId
  )
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return disconnectedWebRuntimeTerminalCreateOutcome()
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)

  let workspaceSelectionRollback: WebRuntimeSessionWorkspaceSelectionRollback | null = null
  if (args.selectWorktree !== false) {
    const previous = readActiveWorkspaceSelection()
    selectWebRuntimeSessionWorktree(args.worktreeId, environmentId)
    workspaceSelectionRollback = {
      previous,
      applied: {
        worktreeId: args.worktreeId,
        executionHostId: toRuntimeExecutionHostId(environmentId)
      }
    }
  }
  let hostCreated = false
  let createdTabId: string | undefined
  let createdLeafId: string | undefined
  let createdTerminalHandle: string | undefined
  try {
    const agent = args.launchAgent ?? args.agent
    // Structured launches resolve host defaults themselves. A renderer-side
    // launchConfig belongs only to the legacy path and must not silently become
    // a CLI override for a capable host.
    const agentArgsOverride = args.agentArgs
    if (agent) {
      let legacyAlreadyPlacedInGroup = false
      // Why: structured creation cannot yet express afterTabId; keep the exact legacy placement contract until it can.
      // Why: focus belongs to the paired client; a headless execution host has no renderer to focus.
      // Why: rebuilding a prepared command through host authority can discard its embedded prompt and delivery flags.
      const mustUseLegacyAgentCreate = args.preparedAgentCommand || args.afterTabId
      const hostAuthority = mustUseLegacyAgentCreate
        ? undefined
        : args.agentSessionKind === 'resume'
          ? args.providerSession
            ? async () =>
                unwrapRuntimeRpcResult(
                  (await callEnvironment({
                    method: 'terminal.ensureAgentSession',
                    params: {
                      kind: 'explicit',
                      worktree: toRuntimeWorktreeSelector(args.worktreeId),
                      agent,
                      providerSession: args.providerSession!,
                      ...(args.launchConfig?.ompResumeFilePath
                        ? { ompResumeFilePath: args.launchConfig.ompResumeFilePath }
                        : {}),
                      ...(agentArgsOverride !== undefined ? { agentArgs: agentArgsOverride } : {}),
                      ...(args.agentPermissionMode
                        ? { agentPermissionMode: args.agentPermissionMode }
                        : {}),
                      ...(args.launchPreferences
                        ? { launchPreferences: args.launchPreferences }
                        : {}),
                      presentation: 'background'
                    },
                    timeoutMs: 15_000
                  })) as RuntimeRpcResponse<RuntimeEnsureAgentSessionResult>
                )
            : undefined
          : async () =>
              await createAgentSessionCreateOperation().run(async (clientOperationId) =>
                unwrapRuntimeRpcResult(
                  (await callEnvironment({
                    method: 'terminal.createAgentSession',
                    params: withAgentSessionCreateOperationId(
                      {
                        worktree: toRuntimeWorktreeSelector(args.worktreeId),
                        agent,
                        ...(args.prompt ? { prompt: args.prompt } : {}),
                        ...(args.promptDelivery ? { promptDelivery: args.promptDelivery } : {}),
                        ...(agentArgsOverride !== undefined
                          ? { agentArgs: agentArgsOverride }
                          : {}),
                        ...(args.agentPermissionMode
                          ? { agentPermissionMode: args.agentPermissionMode }
                          : {}),
                        ...(args.launchPreferences
                          ? { launchPreferences: args.launchPreferences }
                          : {}),
                        ...(args.cwd ? { startupCwd: args.cwd } : {}),
                        ...(args.viewMode ? { viewMode: args.viewMode } : {}),
                        presentation: 'background'
                      },
                      clientOperationId
                    ),
                    timeoutMs: 15_000
                  })) as RuntimeRpcResponse<RuntimeCreateAgentSessionResult>
                )
              )
      const created = await runRemoteAgentSessionLaunch<{
        terminal: CreatedAgentTerminalIdentity
      }>({
        environmentId,
        ...(hostAuthority ? { hostAuthority } : {}),
        hostAuthorityCapabilities: resolveWebRuntimeAgentHostAuthorityCapabilities({
          agent,
          agentSessionKind: args.agentSessionKind,
          agentPermissionMode: args.agentPermissionMode
        }),
        ...(args.agentPermissionMode
          ? {
              legacyFallbackPolicy: 'deny' as const
            }
          : {}),
        legacy: async () => {
          const response = await callEnvironment({
            method: 'session.tabs.createTerminal',
            params: {
              worktree: toRuntimeWorktreeSelector(args.worktreeId),
              afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
              targetGroupId: args.targetGroupId,
              command: args.command,
              cwd: args.cwd,
              ...(args.env ? { env: args.env } : {}),
              ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
              startupCommandDelivery: args.startupCommandDelivery,
              ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
              ...(args.launchToken ? { launchToken: args.launchToken } : {}),
              ...(args.agent ? { agent: args.agent } : {}),
              ...(args.launchAgent ? { launchAgent: args.launchAgent } : {}),
              ...(args.viewMode ? { viewMode: args.viewMode } : {}),
              // Why: old hosts understand activate:false; new hosts use select/navigation for caller-local focus.
              activate: false,
              select: args.activate !== false,
              navigation: 'caller'
            },
            timeoutMs: 15_000
          })
          const legacyCreated = unwrapRuntimeRpcResult(
            response as RuntimeRpcResponse<RuntimeMobileSessionCreateTerminalResult>
          )
          legacyAlreadyPlacedInGroup = true
          return {
            terminal: {
              tabId: legacyCreated.tab.id,
              leafId: legacyCreated.tab.leafId
            }
          }
        }
      })
      hostCreated = true
      createdTabId = created.terminal.tabId
      createdTerminalHandle = created.terminal.handle
      createdLeafId = legacyAlreadyPlacedInGroup
        ? created.terminal.leafId
        : createdTerminalLeafId(created.terminal)
      if (args.targetGroupId && createdTabId && !legacyAlreadyPlacedInGroup) {
        await callEnvironment({
          method: 'session.tabs.move',
          params: {
            worktree: toRuntimeWorktreeSelector(args.worktreeId),
            tabId: createdTabId,
            targetGroupId: args.targetGroupId,
            kind: 'move-to-group'
          },
          timeoutMs: 15_000
        })
      }
    } else {
      const response = await callEnvironment({
        method: 'session.tabs.createTerminal',
        params: {
          worktree: toRuntimeWorktreeSelector(args.worktreeId),
          afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
          targetGroupId: args.targetGroupId,
          command: args.command,
          cwd: args.cwd,
          ...(args.env ? { env: args.env } : {}),
          ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
          startupCommandDelivery: args.startupCommandDelivery,
          ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
          ...(args.launchToken ? { launchToken: args.launchToken } : {}),
          ...(args.viewMode ? { viewMode: args.viewMode } : {}),
          // Why: old hosts understand activate:false; new hosts use select/navigation for caller-local focus.
          activate: false,
          select: args.activate !== false,
          navigation: 'caller'
        },
        timeoutMs: 15_000
      })
      const created = unwrapRuntimeRpcResult(
        response as RuntimeRpcResponse<RuntimeMobileSessionCreateTerminalResult>
      )
      hostCreated = true
      createdTabId = created.tab.id
      createdLeafId = created.tab.leafId
    }
    registerWebRuntimeAgentLaunchConfig({
      agent,
      agentArgs: args.agentArgs,
      agentPermissionMode: args.agentPermissionMode,
      tabId: createdTabId,
      leafId: createdLeafId,
      terminalHandle: createdTerminalHandle
    })
    if (args.targetGroupId && createdTabId) {
      // Why: the host drops client-minted group ids, so this client's own record is what
      // lands the mirrored tab in the requested pane under client-owned placement.
      recordWebSessionTerminalPlacement({
        environmentId,
        worktreeId: args.worktreeId,
        hostTabId: webTerminalPlacementParentTabId(createdTabId),
        groupId: args.targetGroupId
      })
    }
    if (args.activate !== false && createdTabId && matchesWebSessionIntentOwner(intentOwner)) {
      // Why: record focus intent so the reconcile follows the snapshot's active
      // tab to THIS new terminal, instead of sticky-keeping the prior tab.
      recordWebSessionFocusIntent(intentOwner, args.worktreeId, createdTabId, createdLeafId)
    }
    const placementTabId =
      createdTabId && (args.targetGroupId || args.afterTabId) ? createdTabId : undefined
    await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
      expectedEnvironmentPairingRevision: intentOwner.pairingRevision,
      // Why: the publication can beat the RPC response; replay it once after caller intent exists.
      acceptCurrentSnapshot:
        Boolean(createdTabId) && (args.activate !== false || Boolean(placementTabId)),
      // Why: a placement record needs a post-create list; a deduped in-flight one can predate it.
      ...(placementTabId ? { afterCurrentInFlight: true } : {})
    })
    if (placementTabId) {
      await settleWebRuntimeTerminalPlacement(
        environmentId,
        args.worktreeId,
        webTerminalPlacementParentTabId(placementTabId),
        {
          groupId: args.targetGroupId,
          afterTabId: args.afterTabId,
          activate: args.activate !== false
        }
      )
    }
    return {
      outcome: { status: 'created' },
      ...(createdTabId ? { hostTabId: createdTabId } : {})
    }
  } catch (error) {
    if (createdTabId) {
      // Why: a record that outlives the create flow could yank a user-dragged tab back later.
      forgetWebSessionTerminalPlacement({
        environmentId,
        worktreeId: args.worktreeId,
        hostTabId: webTerminalPlacementParentTabId(createdTabId)
      })
    }
    if (!hostCreated && workspaceSelectionRollback) {
      restoreActiveWorkspaceSelection(workspaceSelectionRollback)
    }
    // Why: once the host accepted creation, reporting failure invites the user
    // to retry with a new operation ID and can duplicate a fresh agent.
    return reportWebRuntimeTerminalCreateFailure(error, hostCreated, createdTabId)
  }
}

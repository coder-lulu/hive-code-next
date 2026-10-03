import {
  interpretAtRpcBarrier,
  startRpcOperation,
  type RpcOperationClient
} from '../transport/rpc-operation'
import { RESUME_RPC_TIMEOUT_MS } from '../session/ai-vault-resume-preparation'
import {
  resumeRepos,
  resumeFolders,
  resumeGroups,
  resumeSettings,
  resumeWorktrees
} from './mobile-ai-vault-resume-operations'

export async function loadMobileResumeMetadata(client: RpcOperationClient) {
  const options = { timeoutMs: RESUME_RPC_TIMEOUT_MS }
  const repos = startRpcOperation(client, resumeRepos, undefined, options)
  const folders = startRpcOperation(client, resumeFolders, undefined, options)
  const groups = startRpcOperation(client, resumeGroups, undefined, options)
  const settings = startRpcOperation(client, resumeSettings, undefined, options)
  const worktrees = startRpcOperation(client, resumeWorktrees, { limit: 10000 }, options)
  // Every optional request settles before the required repo reply is interpreted.
  // Its transport rejection remains optional; a required rejection keeps its original identity.
  await Promise.all([
    repos.settlement.then((settled) => {
      if (settled.status === 'rejected') {
        throw settled.error
      }
    }),
    folders.settlement,
    groups.settlement,
    settings.settlement,
    worktrees.settlement
  ])
  const [repoResult] = await interpretAtRpcBarrier([repos])
  const [[folderResult], [groupResult], [settingsResult], [worktreeResult]] = await Promise.all([
    interpretAtRpcBarrier([folders]).catch(() => [null]),
    interpretAtRpcBarrier([groups]).catch(() => [null]),
    interpretAtRpcBarrier([settings]).catch(() => [null]),
    interpretAtRpcBarrier([worktrees]).catch(() => [null])
  ])
  return {
    repos: repoResult.repos ?? [],
    folderWorkspaces: folderResult?.folderWorkspaces ?? [],
    projectGroups: groupResult?.groups ?? [],
    settings: settingsResult?.settings ?? null,
    worktrees: worktreeResult?.worktrees ?? null
  }
}

export function createMobileAiVaultResumeMutationId(sessionId: string): string {
  const sessionPart = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64) || 'session'
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `ai-vault-resume:${sessionPart}:${Date.now().toString(36)}:${randomPart}`
}

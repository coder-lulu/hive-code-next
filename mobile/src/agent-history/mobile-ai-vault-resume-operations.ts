import { z } from 'zod'
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import { parseExecutionHostId } from '../../../src/shared/execution-host'
import { defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

const hostId = z.custom<ExecutionHostId>(
  (value) => typeof value === 'string' && parseExecutionHostId(value) !== null
)
const optionalText = z.string().nullable().optional()
const repo = z.looseObject({
  id: z.string(),
  path: optionalText,
  projectGroupId: optionalText,
  connectionId: optionalText,
  executionHostId: hostId.nullable().optional()
})
const folder = z.looseObject({
  id: z.string(),
  projectGroupId: z.string(),
  folderPath: z.string(),
  connectionId: optionalText
})
const group = z.looseObject({
  id: z.string(),
  parentGroupId: optionalText,
  connectionId: optionalText,
  executionHostId: optionalText
})
const strings = z.record(z.string(), z.string())
const settings = z.looseObject({
  agentCmdOverrides: z.record(z.string(), z.string().nullable()).optional(),
  agentDefaultArgs: strings.optional(),
  agentDefaultEnv: z.record(z.string(), strings).optional()
})
const worktree = z.looseObject({
  worktreeId: z.string(),
  repoId: z.string(),
  repo: z.string(),
  branch: z.string(),
  displayName: z.string(),
  path: z.string(),
  liveTerminalCount: z.number(),
  hasAttachedPty: z.boolean(),
  preview: z.string(),
  unread: z.boolean(),
  isPinned: z.boolean(),
  linkedPR: z.object({ number: z.number(), state: z.string() }).nullable(),
  hostId: hostId.optional(),
  workspaceKind: z.enum(['git', 'folder-workspace']).optional()
})

export const resumeRepos = defineRpcOperation({
  name: 'vault.resumeRepos',
  method: 'repo.list',
  acceptance: 'require-result-or-throw',
  barrier: 'after-all-requests',
  read: rpcResultVariant('repos', z.object({ repos: z.array(repo).optional() }))
})
export const resumeFolders = defineRpcOperation({
  name: 'vault.resumeFolders',
  method: 'folderWorkspace.list',
  acceptance: 'object-result-or-null',
  barrier: 'after-all-requests',
  read: rpcResultVariant('folders', z.object({ folderWorkspaces: z.array(folder).optional() }))
})
export const resumeGroups = defineRpcOperation({
  name: 'vault.resumeGroups',
  method: 'projectGroup.list',
  acceptance: 'object-result-or-null',
  barrier: 'after-all-requests',
  read: rpcResultVariant('groups', z.object({ groups: z.array(group).optional() }))
})
export const resumeSettings = defineRpcOperation({
  name: 'vault.resumeSettings',
  method: 'settings.get',
  acceptance: 'object-result-or-null',
  barrier: 'after-all-requests',
  read: rpcResultVariant('settings', z.object({ settings: settings.optional() }))
})
export const resumeWorktrees = defineRpcOperation({
  name: 'vault.resumeWorktrees',
  method: 'worktree.ps',
  acceptance: 'object-result-or-null',
  barrier: 'after-all-requests',
  read: rpcResultVariant('worktrees', z.object({ worktrees: z.array(worktree).optional() }))
})

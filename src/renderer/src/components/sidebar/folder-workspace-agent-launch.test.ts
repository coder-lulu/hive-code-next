import { describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { resolveFolderWorkspaceAgentLaunch } from './folder-workspace-agent-launch'

vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'win32' }))

function projectGroup(): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Workspace',
    parentPath: '/repo',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('resolveFolderWorkspaceAgentLaunch', () => {
  it('applies a one-launch manual policy without dropping unrelated arguments', () => {
    const result = resolveFolderWorkspaceAgentLaunch({
      projectGroup: projectGroup(),
      agent: 'codex',
      permissionMode: 'manual',
      agentArgs: '--model gpt-5 --dangerously-bypass-approvals-and-sandbox'
    })

    expect(result.permissionConfig?.agentArgs).toBe(
      "'--model' 'gpt-5' '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write'"
    )
  })

  it('uses the remote runtime platform when there is no direct SSH connection', () => {
    const result = resolveFolderWorkspaceAgentLaunch({
      projectGroup: projectGroup(),
      agent: 'codex',
      permissionMode: 'manual',
      agentArgs: '--model gpt-5',
      isRemote: true
    })

    expect(result.platform).toBe('linux')
    expect(result.permissionConfig?.agentArgs).toBe(
      "'--model' 'gpt-5' '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write'"
    )
  })
})

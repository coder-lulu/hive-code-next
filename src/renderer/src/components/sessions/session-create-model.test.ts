import { describe, expect, it } from 'vitest'
import { buildHomeEntities } from '../landing/desktop-home-model-entities'
import {
  sessionCreateDetectionTarget,
  sessionCreateOwner,
  sessionCreateWorkspaces
} from './session-create-model'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

function catalog() {
  const repos = [
    { id: 'repo', displayName: 'Project', path: '/repo', executionHostId: 'local' as const }
  ]
  return buildHomeEntities(
    {
      repos,
      worktreesByRepo: {
        repo: [
          {
            id: 'main',
            repoId: 'repo',
            displayName: 'main',
            path: '/repo',
            branch: 'main',
            hostId: 'local'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    },
    repos
  )
}

describe('session creation workspace catalog', () => {
  it('includes workspaces with no sessions instead of deriving choices from session rows', () => {
    const entities = catalog()
    const project = [...entities.projectsByIdentity.values()][0]
    const choices = sessionCreateWorkspaces(entities, {
      kind: 'project',
      projectKey: project.identityKey
    })
    expect(choices).toHaveLength(1)
    expect(choices[0].sessions).toEqual([])
    expect(sessionCreateOwner(choices[0])).toEqual({ worktreeId: 'main', executionHostId: 'local' })
  })
  it('never widens a missing project to all workspaces or temporary sessions', () => {
    expect(sessionCreateWorkspaces(catalog(), { kind: 'project', projectKey: 'gone' })).toEqual([])
  })
  it('accepts the raw worktree id from creation completion with its exact host', () => {
    const entities = catalog()
    expect(
      sessionCreateWorkspaces(entities, {
        kind: 'workspace',
        workspaceKey: entities.workspaces[0].id,
        executionHostId: 'local'
      })
    ).toEqual([entities.workspaces[0]])
  })
  it('uses the same host-qualified workspace key as the project filter', () => {
    const entities = catalog()
    const project = [...entities.projectsByIdentity.values()][0]
    expect(
      sessionCreateWorkspaces(entities, {
        kind: 'project',
        projectKey: project.identityKey,
        workspaceKey: entities.workspaces[0].identityKey
      })
    ).toEqual([entities.workspaces[0]])
  })
  it('filters a duplicate workspace key by the exact execution host', () => {
    const entities = catalog()
    const local = entities.workspaces[0]
    const remote = {
      ...local,
      executionHostId: 'ssh:server' as const,
      identityKey: 'ssh:server|main'
    }
    entities.workspaces.push(remote)
    expect(
      sessionCreateWorkspaces(entities, {
        kind: 'workspace',
        workspaceKey: local.workspaceKey,
        executionHostId: 'ssh:server'
      })
    ).toEqual([remote])
    expect(sessionCreateOwner(remote)).toEqual({
      worktreeId: 'main',
      executionHostId: 'ssh:server'
    })
    expect(sessionCreateDetectionTarget(remote)).toEqual({ kind: 'ssh', connectionId: 'server' })
  })
  it('keeps folder keys and paired runtime agent detection on the selected owner', () => {
    const folder = {
      ...catalog().workspaces[0],
      kind: 'folder' as const,
      workspaceKey: 'folder:files' as const,
      executionHostId: 'runtime:paired' as const
    }
    expect(sessionCreateOwner(folder)).toEqual({
      worktreeId: 'folder:files',
      executionHostId: 'runtime:paired'
    })
    expect(sessionCreateDetectionTarget(folder)).toEqual({
      kind: 'runtime',
      environmentId: 'paired'
    })
  })
  it('temporary sessions explicitly target local host detection', () => {
    expect(sessionCreateOwner()).toEqual({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      executionHostId: 'local'
    })
    expect(sessionCreateDetectionTarget()).toEqual({
      kind: 'local',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      contextKey: 'host'
    })
  })
})

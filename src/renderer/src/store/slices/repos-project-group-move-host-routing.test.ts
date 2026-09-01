import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'

const projectGroup: ProjectGroup = {
  id: 'group-1',
  name: 'Platform',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function makeRepo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#111',
    addedAt: 1,
    ...overrides
  }
}

const projectGroupsMoveProject = vi.fn()
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  projectGroupsMoveProject.mockReset()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      projectGroups: { moveProject: projectGroupsMoveProject },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('moveProjectToGroup host routing', () => {
  it('routes a dragged local repo explicitly when another runtime is active', async () => {
    const localRepo = makeRepo({ id: 'local-dragged', executionHostId: 'local' })
    const movedRepo = {
      ...localRepo,
      projectGroupId: projectGroup.id,
      projectGroupOrder: 4
    }
    projectGroupsMoveProject.mockResolvedValue(movedRepo)
    const store = createTestStore()
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-active' } as never,
      repos: [localRepo],
      projectGroups: [projectGroup]
    })

    await expect(
      store.getState().moveProjectToGroup(localRepo.id, projectGroup.id, 4, { hostId: 'local' })
    ).resolves.toBe(true)

    expect(projectGroupsMoveProject).toHaveBeenCalledWith({
      projectId: localRepo.id,
      groupId: projectGroup.id,
      order: 4
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(store.getState().repos).toEqual([movedRepo])
  })

  it('moves only the explicitly dragged host when repo ids collide across hosts', async () => {
    const localTwin = makeRepo({
      id: 'shared-repo',
      path: '/local/shared',
      executionHostId: 'local',
      projectGroupId: 'local-group'
    })
    const runtimeTwin = makeRepo({
      id: 'shared-repo',
      path: '/runtime/shared',
      executionHostId: 'runtime:env-dragged',
      projectGroupId: 'runtime-old-group'
    })
    const movedRuntimeTwin = {
      ...runtimeTwin,
      projectGroupId: projectGroup.id,
      projectGroupOrder: 7
    }
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-move-project',
      ok: true,
      result: { repo: movedRuntimeTwin },
      _meta: { runtimeId: 'runtime-dragged' }
    })
    const store = createTestStore()
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-active' } as never,
      repos: [localTwin, runtimeTwin],
      projectGroups: [projectGroup]
    })

    await expect(
      store.getState().moveProjectToGroup('shared-repo', projectGroup.id, 7, {
        hostId: 'runtime:env-dragged'
      })
    ).resolves.toBe(true)

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-dragged',
      method: 'projectGroup.moveProject',
      params: { repo: 'shared-repo', groupId: projectGroup.id, order: 7 },
      timeoutMs: 15_000
    })
    expect(projectGroupsMoveProject).not.toHaveBeenCalled()
    expect(store.getState().repos).toEqual([localTwin, movedRuntimeTwin])
  })
})

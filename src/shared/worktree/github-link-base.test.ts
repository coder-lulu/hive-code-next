import { describe, expect, it } from 'vitest'
import { captureWorktreeGitHubLinkBase } from './github-link-base'

describe('captureWorktreeGitHubLinkBase', () => {
  it('captures an explicit local sparse DTO without inventing an instance or suppression', () => {
    expect(captureWorktreeGitHubLinkBase({ hostId: 'local', linkedPR: null })).toEqual({
      hostId: 'local',
      instanceId: null,
      linkedPR: null,
      suppressedGitHubPR: null
    })
  })

  it('takes the actual identity owner and preserves exact observed metadata', () => {
    expect(
      captureWorktreeGitHubLinkBase({
        identity: { executionHostId: 'ssh:build-host' },
        instanceId: 'workspace-generation-4',
        linkedPR: 71,
        suppressedGitHubPR: 52
      })
    ).toEqual({
      hostId: 'ssh:build-host',
      instanceId: 'workspace-generation-4',
      linkedPR: 71,
      suppressedGitHubPR: 52
    })
  })

  it('accepts consistent owner fields and captures a value independent of later DTO mutation', () => {
    const dto = {
      hostId: 'ssh:remote',
      identity: { executionHostId: 'ssh:remote' },
      instanceId: 'instance-1',
      linkedPR: 7,
      suppressedGitHubPR: null
    }
    const captured = captureWorktreeGitHubLinkBase(dto)
    dto.linkedPR = 8
    dto.instanceId = 'instance-2'
    dto.identity.executionHostId = 'ssh:other'
    expect(captured).toEqual({
      hostId: 'ssh:remote',
      instanceId: 'instance-1',
      linkedPR: 7,
      suppressedGitHubPR: null
    })
  })

  it.each([
    null,
    [],
    'local',
    {},
    { linkedPR: null },
    { hostId: undefined, linkedPR: null },
    { hostId: 'local' },
    { hostId: 'local', linkedPR: undefined },
    { hostId: 'local', linkedPR: 0 },
    { hostId: 'local', linkedPR: -1 },
    { hostId: 'local', linkedPR: 1.5 },
    { hostId: 'local', linkedPR: Number.MAX_SAFE_INTEGER + 1 },
    { hostId: 'local', linkedPR: '7' },
    { hostId: 'all', linkedPR: null },
    { hostId: 'ssh:', linkedPR: null },
    { hostId: 'ssh:%zz', linkedPR: null },
    { hostId: null, identity: { executionHostId: 'local' }, linkedPR: null },
    { hostId: 'local', identity: { executionHostId: 'ssh:other' }, linkedPR: null },
    { hostId: 'local', identity: { executionHostId: 'unknown' }, linkedPR: null },
    { hostId: 'local', identity: [], linkedPR: null },
    { hostId: 'local', identity: null, linkedPR: null },
    { hostId: 'local', instanceId: '', linkedPR: null },
    { hostId: 'local', instanceId: '  ', linkedPR: null },
    { hostId: 'local', instanceId: null, linkedPR: null },
    { hostId: 'local', instanceId: 1, linkedPR: null },
    { hostId: 'local', linkedPR: null, suppressedGitHubPR: 0 },
    { hostId: 'local', linkedPR: null, suppressedGitHubPR: -1 },
    { hostId: 'local', linkedPR: null, suppressedGitHubPR: 1.5 },
    { hostId: 'local', linkedPR: null, suppressedGitHubPR: '8' }
  ])('refuses missing, malformed or conflicting current DTO evidence: %j', (dto) => {
    expect(captureWorktreeGitHubLinkBase(dto)).toBeNull()
  })

  it('does not take a required linkedPR value from an object prototype', () => {
    const dto = Object.assign(Object.create({ linkedPR: null }), { hostId: 'local' })
    expect(captureWorktreeGitHubLinkBase(dto)).toBeNull()
  })

  it('does not manufacture owner evidence from inherited fields', () => {
    expect(
      captureWorktreeGitHubLinkBase(
        Object.assign(Object.create({ hostId: 'local' }), {
          linkedPR: null
        })
      )
    ).toBeNull()
    expect(
      captureWorktreeGitHubLinkBase({
        linkedPR: null,
        identity: Object.create({ executionHostId: 'local' })
      })
    ).toBeNull()
  })
})

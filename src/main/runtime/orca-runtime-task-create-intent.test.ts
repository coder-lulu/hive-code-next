import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { TaskSessionSourceReferenceSchema } from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import type { TaskCodexAccountScope } from '../tasks/task-codex-account-scope'

function fixture() {
  const validate = vi.fn<() => void>()
  const scope: TaskCodexAccountScope = Object.freeze({
    accountId: 'managed-fixture',
    codexHome: '/fixture/managed/home',
    providerAccountId: 'provider-fixture',
    assertCurrent: vi.fn<() => void>(),
    assertMetadataCurrent: vi.fn<() => void>()
  })
  const resolveSelected = vi.fn(() => scope)
  const prepareCodexStructuredLaunch = vi.fn(() => '/personal/home')
  const runtime = new OrcaRuntimeService(undefined, undefined, {
    prepareCodexStructuredLaunch,
    taskCodexAccounts: { resolveSelected, resolvePinned: vi.fn(() => scope) }
  })
  const location: AgentSessionExecutionLocation = {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: 'fixture-workspace',
    workspaceKind: 'folder'
  }
  const resolveLocation = vi.fn(async () => location)
  Object.assign(runtime, { resolveStructuredAgentSessionLocation: resolveLocation })
  const taskOrigin = {
    source: TaskSessionSourceReferenceSchema.parse({
      kind: 'task_execution',
      runtimeRecordId: 'runtime-fixture',
      ownershipEpoch: 1,
      executionId: 'execution-fixture',
      executionEpoch: 1,
      commandFingerprint: 'a'.repeat(64)
    }),
    operationCallerKey: 'caller-fixture',
    operationId: `1791041032000-${'b'.repeat(32)}`,
    launchFingerprint: 'c'.repeat(64),
    validate
  }
  const input = {
    envelope: {
      sessionId: 'codex_fixture_session',
      clientOperationId: `1791041032000-${'d'.repeat(32)}`
    },
    worktree: 'id:fixture-workspace',
    agent: 'codex',
    callerKey: 'caller-fixture',
    taskOrigin
  } satisfies Parameters<OrcaRuntimeService['resolveStructuredAgentSessionCreateIntent']>[0]
  return {
    runtime,
    input,
    scope,
    resolveSelected,
    resolveLocation,
    prepareCodexStructuredLaunch,
    validate,
    location
  }
}

describe('original Runtime Task create intent', () => {
  it('pins a readonly managed home and the controlled options without personal preparation or settings reads', async () => {
    const f = fixture()
    const intent = await f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)
    expect(intent.accountHome).toEqual({ variable: 'CODEX_HOME', path: f.scope.codexHome })
    expect(intent.options).toEqual({ model: 'gpt-6.1-sol', effort: 'low', fastMode: 'false' })
    expect(intent.runtimeKind).toBe('native')
    expect(intent.location).toEqual(f.location)
    expect(f.resolveSelected).toHaveBeenCalledOnce()
    expect(f.scope.assertCurrent).toHaveBeenCalledOnce()
    expect(f.prepareCodexStructuredLaunch).not.toHaveBeenCalled()
  })
  it.each([undefined, null, {}, { validate: () => undefined }])(
    'refuses a present malformed Task origin before resolving a workspace (%j)',
    async (value) => {
      const f = fixture()
      Object.defineProperty(f.input, 'taskOrigin', { value })
      await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
        'FORBIDDEN'
      )
      expect(f.resolveLocation).not.toHaveBeenCalled()
      expect(f.resolveSelected).not.toHaveBeenCalled()
      expect(f.prepareCodexStructuredLaunch).not.toHaveBeenCalled()
    }
  )
  it('refuses a Task routed to another agent', async () => {
    const f = fixture()
    await expect(
      f.runtime.resolveStructuredAgentSessionCreateIntent({ ...f.input, agent: 'claude' })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.resolveLocation).not.toHaveBeenCalled()
    expect(f.resolveSelected).not.toHaveBeenCalled()
  })
  it('refuses Task adoption before workspace or account resolution', async () => {
    const f = fixture()
    await expect(
      f.runtime.resolveStructuredAgentSessionCreateIntent({
        ...f.input,
        resumeFrom: { providerSessionId: 'old-thread' }
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.resolveLocation).not.toHaveBeenCalled()
    expect(f.resolveSelected).not.toHaveBeenCalled()
  })
  it('requires the original operation caller', async () => {
    const f = fixture()
    await expect(
      f.runtime.resolveStructuredAgentSessionCreateIntent({
        ...f.input,
        callerKey: 'foreign-caller'
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.resolveSelected).not.toHaveBeenCalled()
  })
  it('rechecks authorization after resolving the original location', async () => {
    const f = fixture()
    f.resolveLocation.mockImplementation(async () => {
      f.validate.mockImplementation(() => {
        throw new Error('revoked-grant')
      })
      return f.location
    })
    await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
      'revoked-grant'
    )
    expect(f.resolveSelected).not.toHaveBeenCalled()
  })
  it('rejects an asynchronous rejected grant and observes it', async () => {
    const f = fixture()
    Object.defineProperty(f.input.taskOrigin, 'validate', {
      value: () => Promise.reject(new Error('late-denial'))
    })
    await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
      'FORBIDDEN'
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.resolveLocation).not.toHaveBeenCalled()
  })
  it.each([
    { executionHostId: 'ssh:foreign', wslDistro: null },
    { executionHostId: 'local', wslDistro: 'Ubuntu' },
    { workspaceId: 'another-workspace' }
  ])('refuses a foreign execution location before selecting credentials (%j)', async (change) => {
    const f = fixture()
    Object.assign(f.location, change)
    await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(f.resolveSelected).not.toHaveBeenCalled()
  })
  it('reports a missing readonly account port explicitly', async () => {
    const f = fixture()
    Object.assign(f.runtime, { taskCodexAccounts: null })
    await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
      'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE'
    )
    expect(f.prepareCodexStructuredLaunch).not.toHaveBeenCalled()
  })
  it('requires a full current account observation', async () => {
    const f = fixture()
    vi.mocked(f.scope.assertCurrent).mockImplementation(() => {
      throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
    })
    await expect(f.runtime.resolveStructuredAgentSessionCreateIntent(f.input)).rejects.toThrow(
      'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE'
    )
  })
})

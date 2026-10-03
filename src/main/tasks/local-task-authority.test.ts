import { describe, expect, it, vi } from 'vitest'
import { createLocalTaskAuthorizer, type LocalTaskGrant } from './local-task-authority'
import {
  taskCommand,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'

function fixture() {
  const command = taskCommand()
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'account:one',
    authorityId: 'authority:one',
    sessionGeneration: 1,
    sessionExpiresAt: TASK_TEST_NOW + 120_000,
    accessToken: 'test-only-token'
  }
  const grant: LocalTaskGrant = {
    command,
    ...TASK_TEST_CALLER,
    workspace: taskWorkspace('/isolated-test-root'),
    input: 'Create report.md.',
    accountId: account.accountId,
    authorityId: account.authorityId,
    sessionGeneration: account.sessionGeneration,
    validUntil: TASK_TEST_NOW + 120_000,
    actions: ['start', 'observe', 'cancel', 'reconcile'],
    assertCurrent: vi.fn()
  }
  let currentGrant: LocalTaskGrant | null = grant
  const authorize = createLocalTaskAuthorizer({
    currentAccount: () => account,
    currentRuntime: () => ({
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      accountId: 'account:one'
    }),
    resolveGrant: (ref) => (ref === command.authorizationRef ? currentGrant : null),
    now: () => TASK_TEST_NOW
  })
  return {
    command,
    grant,
    authorize,
    revokeGrant: () => {
      currentGrant = null
    },
    replaceGrant: () => {
      currentGrant = { ...grant }
    },
    signOut: () => {
      account = null
    },
    changeAccount: () => {
      account = { ...account!, accountId: 'account:another' }
    }
  }
}

describe('local service grants and account ownership', () => {
  it('uses a server-side grant and the current authenticated account', async () => {
    const { authorize, command, grant } = fixture()
    expect((await authorize(TASK_TEST_CALLER, command, 'start')).workspace).toEqual(grant.workspace)
  })
  it('rechecks sign-out at the final transaction/dispatch boundary', async () => {
    const { authorize, command, signOut } = fixture()
    const authorization = await authorize(TASK_TEST_CALLER, command, 'start')
    signOut()
    expect(authorization.assertCurrent).toThrow('FORBIDDEN')
  })
  it.each(['revokeGrant', 'replaceGrant'] as const)(
    'rechecks %s after asynchronous admission has obtained authorization',
    async (change) => {
      const current = fixture()
      const authorization = await current.authorize(TASK_TEST_CALLER, current.command, 'start')
      current[change]()
      expect(authorization.assertCurrent).toThrow('FORBIDDEN')
    }
  )
  it('does not accept a same-device account switch as authority', async () => {
    const { authorize, command, changeAccount } = fixture()
    changeAccount()
    await expect(authorize(TASK_TEST_CALLER, command, 'start')).rejects.toThrow('FORBIDDEN')
  })
  it.each([
    'executionAccountRef',
    'workspaceRef',
    'profileRevision',
    'authorizationRevision',
    'billingSubjectRef',
    'inputRef'
  ] as const)('rejects changes to the granted %s', async (field) => {
    const { authorize, command } = fixture()
    await expect(
      authorize(TASK_TEST_CALLER, { ...command, [field]: 'ref:changed' }, 'start')
    ).rejects.toThrow('FORBIDDEN')
  })
  it('does not authorize observe merely because the caller can start', async () => {
    const { authorize, command, grant } = fixture()
    grant.actions = ['start']
    await expect(authorize(TASK_TEST_CALLER, command, 'observe')).rejects.toThrow('FORBIDDEN')
  })
  it('rejects an unknown grant without trying to launch', async () => {
    const { authorize, command } = fixture()
    await expect(
      authorize(TASK_TEST_CALLER, { ...command, authorizationRef: 'grant:unknown' }, 'start')
    ).rejects.toThrow('FORBIDDEN')
  })
})

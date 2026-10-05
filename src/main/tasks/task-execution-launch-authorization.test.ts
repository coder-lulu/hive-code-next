import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { TaskExecutionHost } from './task-execution-host'
import type {
  TaskExecutionAuthorization,
  TaskExecutionHostDependencies
} from './task-execution-ports'
import type { TaskExecutionRecord } from './task-execution-record'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  taskCapabilities,
  taskCommand,
  taskStopEvidence,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const temporaryRoot = resolve(
  'logs/paperclip-development/p3/controlled-runtime/delivery-writer/tmp'
)
const hosts: TaskExecutionHost[] = []
const directories: string[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.drain()
  }
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(temporaryRoot + sep)) {
      throw new Error('UNOWNED_TEST_DIRECTORY')
    }
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  await mkdir(temporaryRoot, { recursive: true })
  const directory = await mkdtemp(join(temporaryRoot, 'launch-'))
  directories.push(directory)
  const store = await openTestAgentSessionRecordStore(directory)
  const dispatch = {
    prepare: vi.fn<() => Promise<void>>(async () => undefined),
    assertCurrent: vi.fn<() => void>(() => undefined)
  }
  const source = {
    workspace: taskWorkspace(directory),
    input: 'Private fixture input.',
    assertCurrent: vi.fn<() => void>(() => undefined),
    dispatch
  }
  let launchAction: TaskExecutionHostDependencies['launch'] = async () => TASK_TEST_LAUNCH
  let captured: TaskExecutionAuthorization | undefined
  const deps: TaskExecutionHostDependencies = {
    store: store.tasks,
    now: () => TASK_TEST_NOW,
    capabilities: () => taskCapabilities(),
    authorize: vi.fn(async () => source),
    launch: vi.fn(async (record, authorization) => {
      captured = authorization
      authorization.assertCurrent()
      return launchAction(record, authorization)
    }),
    collect: vi.fn(async () => null),
    stop: vi.fn(async (record) => taskStopEvidence(record))
  }
  const host = new TaskExecutionHost(deps)
  hosts.push(host)
  return {
    host,
    deps,
    dispatch,
    source,
    command: taskCommand(),
    runLaunch(action: TaskExecutionHostDependencies['launch']) {
      launchAction = action
    },
    authorization() {
      if (!captured) {
        throw new Error('LAUNCH_AUTHORIZATION_NOT_CAPTURED')
      }
      return captured
    }
  }
}

function launchDispatch(authorization: TaskExecutionAuthorization) {
  if (!authorization.dispatch) {
    throw new Error('DISPATCH_AUTHORIZATION_MISSING')
  }
  return authorization.dispatch
}

describe('original task launch authorization lifecycle', () => {
  it('keeps the captured continuing guard valid after the original launch becomes bound', async () => {
    const current = await fixture()
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(current.deps.store.get(current.command)?.dispatch).toBe('bound')
    expect(current.authorization().assertCurrent).not.toThrow()
  })
  it('cannot prepare or spawn again after the original launch is bound', async () => {
    const current = await fixture()
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    const dispatch = launchDispatch(current.authorization())
    expect(dispatch.assertCurrent).toThrow('OUTCOME_UNKNOWN')
    await expect(dispatch.prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(current.dispatch.prepare).not.toHaveBeenCalled()
  })
  it('does not consume the startup lease for continuing effects after binding', async () => {
    const current = await fixture()
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    current.dispatch.assertCurrent.mockImplementation(() => {
      throw new Error('DELIVERY_EXPIRED')
    })
    expect(current.authorization().assertCurrent).not.toThrow()
    current.source.assertCurrent.mockImplementation(() => {
      throw new Error('SOURCE_REVOKED')
    })
    expect(current.authorization().assertCurrent).toThrow('SOURCE_REVOKED')
  })
  it('keeps isolated host DI without inventing a missing dispatch port', async () => {
    const current = await fixture()
    current.deps.authorize = vi.fn(async () => ({
      workspace: current.source.workspace,
      input: current.source.input,
      assertCurrent: () => undefined
    }))
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(current.authorization().dispatch).toBeUndefined()
    expect(current.authorization().assertCurrent).not.toThrow()
  })
  it('requires a strict synchronous dispatch guard before admitting any source', async () => {
    const current = await fixture()
    Object.defineProperty(current.dispatch, 'assertCurrent', {
      value: async () => undefined
    })
    await expect(current.host.start(current.command, TASK_TEST_CALLER)).rejects.toThrow('FORBIDDEN')
    expect(current.deps.store.get(current.command)).toBeNull()
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('rechecks the initial delivery proof inside the admission transaction', async () => {
    const current = await fixture()
    const admit = current.deps.store.admit.bind(current.deps.store)
    vi.spyOn(current.deps.store, 'admit').mockImplementation(async (input) => {
      current.dispatch.assertCurrent.mockImplementation(() => {
        throw new Error('DELIVERY_EXPIRED')
      })
      return admit(input)
    })
    await expect(current.host.start(current.command, TASK_TEST_CALLER)).rejects.toThrow(
      'DELIVERY_EXPIRED'
    )
    expect(current.deps.store.get(current.command)).toBeNull()
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('rechecks the original delivery proof inside beginDispatch without releasing the source', async () => {
    const current = await fixture()
    const begin = current.deps.store.beginDispatch.bind(current.deps.store)
    vi.spyOn(current.deps.store, 'beginDispatch').mockImplementation(async (...args) => {
      current.dispatch.assertCurrent.mockImplementation(() => {
        throw new Error('DELIVERY_EXPIRED')
      })
      return begin(...args)
    })
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(current.deps.launch).not.toHaveBeenCalled()
    expect(current.deps.store.get(current.command)?.status).toBe('outcome_unknown')
    expect(current.deps.store.get(current.command)?.result).toBeNull()
  })
  it.each(['async', 'value'])(
    'rejects a continuing source guard that becomes %s after binding',
    async (kind) => {
      const current = await fixture()
      await current.host.start(current.command, TASK_TEST_CALLER)
      await current.host.drain()
      current.source.assertCurrent.mockImplementation(
        kind === 'async' ? () => Promise.resolve() : () => true
      )
      expect(current.authorization().assertCurrent).toThrow('FORBIDDEN')
    }
  )
  it('rejects a non-undefined preparation before the launch effect', async () => {
    const current = await fixture()
    Object.defineProperty(current.dispatch, 'prepare', { value: async () => 'not-prepared' })
    const effect = vi.fn()
    current.runLaunch(async (_record, authorization) => {
      await launchDispatch(authorization).prepare()
      effect()
      return TASK_TEST_LAUNCH
    })
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(effect).not.toHaveBeenCalled()
    expect(current.deps.store.get(current.command)?.status).toBe('outcome_unknown')
  })
  it('refreshes dispatch authorization before an actual launch effect', async () => {
    const current = await fixture()
    const effect = vi.fn()
    current.runLaunch(async (_record, authorization) => {
      const dispatch = launchDispatch(authorization)
      await dispatch.prepare()
      dispatch.assertCurrent()
      effect()
      return TASK_TEST_LAUNCH
    })
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(current.dispatch.prepare).toHaveBeenCalledTimes(1)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(current.deps.store.get(current.command)?.dispatch).toBe('bound')
  })
  it('rechecks cancellation after a held private preparation', async () => {
    const current = await fixture()
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const preparing = new Promise<void>((resolve) => {
      entered = resolve
    })
    current.dispatch.prepare.mockImplementation(async () => {
      entered()
      await pending
    })
    const effect = vi.fn()
    current.runLaunch(async (_record, authorization) => {
      await launchDispatch(authorization).prepare()
      effect()
      return TASK_TEST_LAUNCH
    })
    await current.host.start(current.command, TASK_TEST_CALLER)
    await preparing
    try {
      await current.deps.store.requestCancellation(
        current.command,
        'cancel:held-prepare',
        TASK_TEST_NOW,
        current.source.assertCurrent
      )
    } finally {
      release()
    }
    await current.host.drain()
    expect(effect).not.toHaveBeenCalled()
    expect(current.deps.store.get(current.command)?.cancellationKey).toBe('cancel:held-prepare')
    expect(current.deps.store.get(current.command)?.result).toBeNull()
  })
  it('rejects a source revoked while preparation is pending', async () => {
    const current = await fixture()
    const effect = vi.fn()
    current.dispatch.prepare.mockImplementation(async () => {
      current.source.assertCurrent.mockImplementation(() => {
        throw new Error('SOURCE_REVOKED')
      })
    })
    current.runLaunch(async (_record, authorization) => {
      await launchDispatch(authorization).prepare()
      effect()
      return TASK_TEST_LAUNCH
    })
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    expect(effect).not.toHaveBeenCalled()
  })
  it.each(['cancelled', 'unknown', 'terminal'])(
    'refuses continuing effects after the original source becomes %s',
    async (state) => {
      const current = await fixture()
      await current.host.start(current.command, TASK_TEST_CALLER)
      await current.host.drain()
      if (state === 'cancelled') {
        await current.deps.store.requestCancellation(
          current.command,
          'cancel:bound',
          TASK_TEST_NOW,
          current.source.assertCurrent
        )
      } else if (state === 'unknown') {
        await current.deps.store.markUnknown(current.command, TASK_TEST_NOW)
      } else {
        current.deps.collect = vi.fn(async () => ({ outcomeRef: 'outcome:test', artifactRefs: [] }))
        await current.host.reconcile(
          {
            protocolVersion: current.command.protocolVersion,
            runtimeRecordId: current.command.runtimeRecordId,
            ownershipEpoch: current.command.ownershipEpoch,
            executionId: current.command.executionId,
            executionEpoch: current.command.executionEpoch,
            commandFingerprint: computeTaskExecutionFingerprint(
              current.command,
              TASK_TEST_CALLER.operationCallerKey
            ),
            authorizationRef: current.command.authorizationRef,
            authorizationRevision: current.command.authorizationRevision,
            expiresAt: current.command.expiresAt,
            kind: 'execution.reconcile'
          },
          TASK_TEST_CALLER
        )
        expect(current.deps.store.get(current.command)?.result?.status).toBe('succeeded')
      }
      const effect = vi.fn()
      expect(() => {
        current.authorization().assertCurrent()
        effect()
      }).toThrow('OUTCOME_UNKNOWN')
      expect(effect).not.toHaveBeenCalled()
    }
  )
  it.each([
    { operationCallerKey: 'caller:foreign' },
    { commandFingerprint: 'f'.repeat(64) },
    { command: taskCommand({ writeFence: 2 }) },
    { workspace: taskWorkspace('/foreign-source') },
    { launch: { ...TASK_TEST_LAUNCH, worktreeId: 'foreign-workspace' } },
    { dispatch: 'not_dispatched' },
    { status: 'accepted' },
    { dispatch: 'dispatching', launch: null }
  ] satisfies Partial<TaskExecutionRecord>[])(
    'refuses a substituted source binding %j',
    async (patch) => {
      const current = await fixture()
      await current.host.start(current.command, TASK_TEST_CALLER)
      await current.host.drain()
      const record = current.deps.store.get(current.command)
      if (!record) {
        throw new Error('SOURCE_NOT_FOUND')
      }
      vi.spyOn(current.deps.store, 'get').mockReturnValue({ ...record, ...patch })
      expect(current.authorization().assertCurrent).toThrow('OUTCOME_UNKNOWN')
    }
  )
  it('refuses a missing original source without falling back to a dispatch grant', async () => {
    const current = await fixture()
    await current.host.start(current.command, TASK_TEST_CALLER)
    await current.host.drain()
    vi.spyOn(current.deps.store, 'get').mockReturnValue(null)
    expect(current.authorization().assertCurrent).toThrow('OUTCOME_UNKNOWN')
  })
})

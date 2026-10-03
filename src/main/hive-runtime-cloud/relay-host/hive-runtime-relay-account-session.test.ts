import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveRuntimeRelayAccountSession } from './hive-runtime-relay-account-session'
import { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type {
  HiveRuntimeRelayAssignment,
  HiveRuntimeRelayConsumeResult
} from './hive-runtime-relay-types'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups
    .splice(0)
    .toReversed()
    .forEach((cleanup) => cleanup())
  vi.useRealTimers()
})
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'hive-account-'))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  const boot = randomUUID()
  const outbox = new HiveRuntimeRelaySessionTransitionOutbox({
    path: join(path, 'outbox.json'),
    runtimeId: 'runtime',
    runtimeBootId: boot
  })
  const clientKey = Buffer.alloc(32, 2)
  const assignment = {
    context: { tuple: { bootId: boot } },
    hostPublicKeyB64: Buffer.alloc(32, 1).toString('base64url'),
    assignmentId: randomUUID(),
    cellId: 'cell',
    cellIncarnationId: randomUUID(),
    assignmentEpoch: 1,
    controlGeneration: 2
  } as HiveRuntimeRelayAssignment
  const connection: ConnectionOpen = {
    type: 'conn-open',
    v: 2,
    kind: 'ticket',
    connId: 'conn-1',
    connTicket: 'A'.repeat(43),
    intentId: randomUUID(),
    clientKeyHash: createHash('sha256').update(clientKey).digest('base64url'),
    assignmentEpoch: 1,
    controlGeneration: 2,
    attachDeadlineMs: 5000
  }
  const binding = {
    clientPublicKeyB64: clientKey.toString('base64'),
    transcriptHashB64: Buffer.alloc(32, 3).toString('base64')
  }
  const auth = {
    type: 'e2ee_auth' as const,
    principalKind: 'account_runtime_session' as const,
    ticketId: randomUUID(),
    ticketSecret: 'A'.repeat(43)
  }
  const result: HiveRuntimeRelayConsumeResult = {
    protocolVersion: 'account-runtime-ticket-consume/v2',
    status: 'PENDING_ACTIVATION',
    managedSessionId: randomUUID(),
    runtimeSessionId: randomUUID(),
    operationCallerKey: `account-runtime:${'a'.repeat(64)}`,
    activationDeadlineAt: Date.now() + 120000,
    absoluteExpiresAt: Date.now() + 28800000,
    controlVersion: 1
  }
  const consume = vi.fn(async () => result)
  let current = true
  let authority = Date.now() + 120000
  const onClose = vi.fn()
  const session = new HiveRuntimeRelayAccountSession({
    assignment,
    connection,
    client: { consume },
    outbox,
    isCurrent: () => current,
    getSessionAuthorityUntil: () => authority,
    requestHeartbeat: vi.fn(),
    onClose,
    onPersistenceFailure: vi.fn()
  })
  cleanups.push(() => session.close())
  const controller = new AbortController()
  const activate = () => {
    const transition = outbox.snapshot()[0]!
    outbox.acknowledge({
      ackedSessionTransitionSequence: transition.sequence,
      sessionTransitionResults: [
        {
          sequence: transition.sequence,
          transitionId: transition.transitionId,
          verdict: 'APPLIED',
          stored: true,
          resultingStatus: 'ACTIVE',
          resultingControlVersion: 2
        }
      ]
    })
  }
  return {
    session,
    auth,
    binding,
    consume,
    result,
    outbox,
    controller,
    activate,
    onClose,
    setCurrent: (value: boolean) => {
      current = value
    },
    setAuthority: (value: number) => {
      authority = value
    }
  }
}
async function flush() {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve()
  }
}

describe('Account consume and activation', () => {
  it('requires adjudication plus ACK and makes only one consume attempt', async () => {
    const f = fixture()
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    await flush()
    expect(f.outbox.snapshot().map((item) => item.transitionType)).toEqual(['ACTIVATE'])
    expect(await f.session.authenticate(f.auth, f.controller.signal, f.binding)).toBeNull()
    expect(f.consume).toHaveBeenCalledOnce()
    f.activate()
    expect(await pending).toMatchObject({
      principalKind: 'account_runtime_session',
      runtimeSessionId: f.result.runtimeSessionId
    })
    expect(f.session.revalidate(true)).toBe(true)
  })
  it('rejects an unrelated authenticated client key before Cloud consume', async () => {
    const f = fixture()
    expect(
      await f.session.authenticate(f.auth, f.controller.signal, {
        ...f.binding,
        clientPublicKeyB64: Buffer.alloc(32, 4).toString('base64')
      })
    ).toBeNull()
    expect(f.consume).not.toHaveBeenCalled()
  })
  it('records late consume ABANDON after cancellation and never ACTIVATEs', async () => {
    const f = fixture()
    let resolve!: (result: HiveRuntimeRelayConsumeResult) => void
    f.consume.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    f.controller.abort()
    resolve(f.result)
    expect(await pending).toBeNull()
    expect(f.outbox.snapshot().map((item) => item.transitionType)).toEqual(['ABANDON'])
  })
  it('closes late ACTIVATE with its resulting version after cancelling local wait', async () => {
    const f = fixture()
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    await flush()
    f.controller.abort()
    expect(await pending).toBeNull()
    f.activate()
    await flush()
    expect(f.outbox.snapshot().at(-1)).toMatchObject({
      transitionType: 'CLOSE',
      expectedControlVersion: 2
    })
    const remaining = f.outbox.snapshot()
    f.outbox.acknowledge({
      ackedSessionTransitionSequence: remaining.at(-1)!.sequence,
      sessionTransitionResults: remaining.map((transition) => ({
        sequence: transition.sequence,
        transitionId: transition.transitionId,
        verdict:
          transition.transitionType === 'ABANDON'
            ? ('REJECTED_STALE_VERSION' as const)
            : ('APPLIED' as const),
        stored: true,
        resultingStatus:
          transition.transitionType === 'ABANDON' ? ('ACTIVE' as const) : ('CLOSED' as const),
        resultingControlVersion: transition.transitionType === 'ABANDON' ? 2 : 3
      }))
    })
    expect(f.outbox.pendingCount).toBe(0)
  })
  it('fences a changed assignment after consume', async () => {
    const f = fixture()
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    f.setCurrent(false)
    expect(await pending).toBeNull()
    expect(f.outbox.snapshot()[0]).toMatchObject({ transitionType: 'ABANDON' })
  })
  it('expires authority without incoming RPC and never revives a timed-out session', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setAuthority(Date.now() + 100)
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    await flush()
    f.activate()
    expect(await pending).not.toBeNull()
    vi.advanceTimersByTime(100)
    expect(f.onClose).toHaveBeenCalledOnce()
    expect(f.outbox.snapshot()[0]).toMatchObject({ transitionType: 'AUTHORITY_EXPIRE' })
    f.setAuthority(Date.now() + 120000)
    f.session.refreshAuthority()
    expect(f.session.revalidate()).toBe(false)
  })
  it('does not extend authority when the wall clock moves backwards', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setAuthority(Date.now() + 100)
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    await flush()
    f.activate()
    expect(await pending).not.toBeNull()
    vi.setSystemTime(Date.now() - 60_000)
    vi.advanceTimersByTime(100)
    expect(f.onClose).toHaveBeenCalledOnce()
    expect(f.outbox.snapshot()[0]).toMatchObject({ transitionType: 'AUTHORITY_EXPIRE' })
  })
  it.each(['absolute', 'idle', 'revoke'] as const)(
    'enforces %s independently of authenticated traffic',
    async (deadline) => {
      vi.useFakeTimers()
      const f = fixture()
      if (deadline === 'absolute') {
        f.consume.mockResolvedValue({
          ...f.result,
          activationDeadlineAt: Date.now() + 500,
          absoluteExpiresAt: Date.now() + 1000
        })
      }
      const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
      await flush()
      f.activate()
      expect(await pending).not.toBeNull()
      if (deadline === 'absolute') {
        vi.advanceTimersByTime(1000)
      }
      if (deadline === 'revoke') {
        f.session.revoke()
      }
      if (deadline === 'idle') {
        for (let minute = 0; minute < 15; minute++) {
          vi.advanceTimersByTime(60000)
          f.setAuthority(Date.now() + 120000)
          f.session.refreshAuthority()
        }
      }
      expect(f.onClose).toHaveBeenCalledOnce()
      expect(f.session.revalidate(true)).toBe(false)
      expect(f.outbox.snapshot().at(-1)?.transitionType).toBe(
        deadline === 'revoke' ? undefined : deadline === 'idle' ? 'IDLE_EXPIRE' : 'CLOSE'
      )
    }
  )
  it('keeps revoke command acknowledgement separate even when ACTIVATE finishes late', async () => {
    const f = fixture()
    const pending = f.session.authenticate(f.auth, f.controller.signal, f.binding)
    await flush()
    expect(f.session.managedSessionId).toBe(f.result.managedSessionId)
    f.session.revoke()
    expect(await pending).toBeNull()
    f.activate()
    await flush()
    expect(f.outbox.snapshot()).toEqual([])
    expect(f.session.revalidate()).toBe(false)
  })
})

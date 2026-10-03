import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RuntimeSessionsScreen from '../../app/runtime-sessions'
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { RuntimeSession, RuntimeSessionPage } from './account-runtime-directory-types'

const dependencies = vi.hoisted(() => ({
  accountSession: null as MobileSession | null,
  alert: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn()
}))

vi.mock('react-native', () => ({ Alert: { alert: dependencies.alert } }))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    }
  }
})

vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: dependencies.accountSession })
}))

vi.mock('./account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({
    listSessions: dependencies.listSessions,
    revokeSession: dependencies.revokeSession
  })
}))

vi.mock('../capabilities/FutureFeatureUI', async () => {
  const React = await import('react')
  const component = (name: string) =>
    function MockFutureFeatureComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as never)
    }
  return {
    FutureFeatureAction: component('FutureFeatureAction'),
    FutureFeatureNotice: component('FutureFeatureNotice'),
    FutureFeatureRow: component('FutureFeatureRow'),
    FutureFeatureScreen: component('FutureFeatureScreen'),
    FutureFeatureSection: component('FutureFeatureSection')
  }
})

function account(accountId: string): MobileSession {
  return {
    authorityId: 'authority',
    account: { accountId },
    accessToken: `${accountId}-token`
  } as MobileSession
}

function runtimeSession(label: string, id: string): RuntimeSession {
  return {
    managedSessionId: id,
    backendAuthorityId: 'authority',
    runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
    runtimeSessionId: '33333333-3333-4333-8333-333333333333',
    clientKind: 'MOBILE',
    clientLabel: label,
    status: 'ACTIVE',
    resourceVersion: 1,
    controlVersion: 1,
    createdAt: '2026-08-31T00:00:00Z',
    expiresAt: '2026-08-31T01:00:00Z',
    revokeRequestedAt: null,
    revokeAcknowledgedAt: null
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(RuntimeSessionsScreen))
    await Promise.resolve()
  })
  return renderer!
}

function row(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('FutureFeatureRow').find((item) => item.props.label === label)
}

describe('Runtime sessions account isolation', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    dependencies.accountSession = account('account-a')
    dependencies.alert.mockReset()
    dependencies.listSessions.mockReset()
    dependencies.revokeSession.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('hides already-loaded account A rows immediately after switching to B', async () => {
    const a = runtimeSession('A Phone', '11111111-1111-4111-8111-111111111111')
    const b = runtimeSession('B Phone', '44444444-4444-4444-8444-444444444444')
    const bList = deferred<RuntimeSessionPage>()
    dependencies.listSessions
      .mockResolvedValueOnce({ items: [a], nextCursor: null })
      .mockReturnValueOnce(bList.promise)
    renderer = await renderScreen()
    await vi.waitFor(() => expect(row(renderer!, '手机 · A Phone')).toBeDefined())

    dependencies.accountSession = account('account-b')
    await act(async () => {
      renderer?.update(createElement(RuntimeSessionsScreen))
      await Promise.resolve()
    })
    expect(row(renderer, '手机 · A Phone')).toBeUndefined()

    await act(async () => {
      bList.resolve({ items: [b], nextCursor: null })
      await bList.promise
    })
    expect(row(renderer, '手机 · B Phone')).toBeDefined()
    expect(row(renderer, '手机 · A Phone')).toBeUndefined()
  })

  it('fences an account A list response that arrives after switching to B', async () => {
    const a = runtimeSession('A Phone', '11111111-1111-4111-8111-111111111111')
    const b = runtimeSession('B Phone', '44444444-4444-4444-8444-444444444444')
    const aList = deferred<RuntimeSessionPage>()
    const bList = deferred<RuntimeSessionPage>()
    dependencies.listSessions.mockReturnValueOnce(aList.promise).mockReturnValueOnce(bList.promise)
    renderer = await renderScreen()

    dependencies.accountSession = account('account-b')
    await act(async () => {
      renderer?.update(createElement(RuntimeSessionsScreen))
      await Promise.resolve()
    })
    await act(async () => {
      aList.resolve({ items: [a], nextCursor: null })
      await aList.promise
    })
    expect(row(renderer, '手机 · A Phone')).toBeUndefined()

    await act(async () => {
      bList.resolve({ items: [b], nextCursor: null })
      await bList.promise
    })
    expect(row(renderer, '手机 · B Phone')).toBeDefined()
  })

  it('does not let an old-account revoke disable or alert in the new account', async () => {
    const a = runtimeSession('A Phone', '11111111-1111-4111-8111-111111111111')
    const b = runtimeSession('B Phone', '44444444-4444-4444-8444-444444444444')
    const revokeA = deferred<RuntimeSession>()
    dependencies.listSessions
      .mockResolvedValueOnce({ items: [a], nextCursor: null })
      .mockResolvedValueOnce({ items: [b], nextCursor: null })
    dependencies.revokeSession.mockReturnValueOnce(revokeA.promise)
    renderer = await renderScreen()
    await vi.waitFor(() => expect(row(renderer!, '手机 · A Phone')).toBeDefined())

    act(() => row(renderer!, '手机 · A Phone')!.props.onPress())
    const confirm = dependencies.alert.mock.calls[0]?.[2]?.[1]?.onPress
    expect(confirm).toBeTypeOf('function')
    act(() => confirm())

    dependencies.accountSession = account('account-b')
    await act(async () => {
      renderer?.update(createElement(RuntimeSessionsScreen))
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(row(renderer!, '手机 · B Phone')).toBeDefined())
    expect(row(renderer, '手机 · B Phone')!.props.disabled).toBe(false)

    await act(async () => {
      revokeA.reject(new Error('old account failure'))
      await revokeA.promise.catch(() => undefined)
    })
    expect(dependencies.alert).toHaveBeenCalledTimes(1)
  })

  it('fetches pages only on navigation and replaces the previous page', async () => {
    const first = runtimeSession('First', '11111111-1111-4111-8111-111111111111')
    const second = runtimeSession('Second', '44444444-4444-4444-8444-444444444444')
    dependencies.listSessions
      .mockResolvedValueOnce({ items: [first], nextCursor: 'second' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null })
      .mockResolvedValueOnce({ items: [first], nextCursor: 'second' })
    renderer = await renderScreen()
    expect(dependencies.listSessions).toHaveBeenCalledExactlyOnceWith(null)
    const action = (label: string) =>
      renderer!.root
        .findAllByType('FutureFeatureAction')
        .find((item) => item.props.label === label)!
    expect(action('上一页').props.disabled).toBe(true)
    await act(async () => action('下一页').props.onPress())
    expect(dependencies.listSessions).toHaveBeenLastCalledWith('second')
    expect(row(renderer, '手机 · First')).toBeUndefined()
    expect(row(renderer, '手机 · Second')).toBeDefined()
    expect(action('下一页').props.disabled).toBe(true)
    await act(async () => action('上一页').props.onPress())
    expect(dependencies.listSessions).toHaveBeenLastCalledWith(null)
    expect(row(renderer, '手机 · First')).toBeDefined()
  })

  it('shows terminal connection failures without a revoke action', async () => {
    const ended = {
      ...runtimeSession('Ended', '11111111-1111-4111-8111-111111111111'),
      status: 'UNVERIFIABLE'
    }
    dependencies.listSessions.mockResolvedValueOnce({ items: [ended], nextCursor: null })
    renderer = await renderScreen()
    expect(row(renderer, '手机 · Ended')!.props.value).toBe('连接已失效')
    expect(row(renderer, '手机 · Ended')!.props.disabled).toBe(true)
    expect(row(renderer, '手机 · Ended')!.props.onPress).toBeUndefined()
  })
})

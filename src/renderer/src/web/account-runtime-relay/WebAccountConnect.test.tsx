// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import WebAccountConnect from './WebAccountConnect'
import type * as WebAccountSessionModule from './web-account-session'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  runtime: vi.fn(),
  runtimes: vi.fn(),
  close: vi.fn(),
  call: vi.fn()
}))
vi.mock('./web-account-session', async (load) => {
  const actual = await load<typeof WebAccountSessionModule>()
  return {
    ...actual,
    WebAccountSession: class {
      restore = mocks.restore
      runtime = mocks.runtime
      runtimes = mocks.runtimes
      close = mocks.close
    }
  }
})
vi.mock('./web-account-relay-client', () => ({
  createWebAccountRelayClient: () => ({ call: mocks.call, close: mocks.close })
}))
const id = '11111111-1111-4111-8111-111111111111'
const runtime = {
  runtimeRecordId: id,
  resourceVersion: 9,
  status: 'CLAIMED',
  connectionCapabilities: ['hive-relay', 'ticket-connect-v2']
}

describe('console Runtime launch', () => {
  let previousLanguage: string

  beforeEach(async () => {
    previousLanguage = i18n.language
    await i18n.changeLanguage('zh')
    vi.clearAllMocks()
    window.history.replaceState({}, '', `/runtime/?runtime=${id}`)
    mocks.restore.mockResolvedValue(true)
    mocks.runtime.mockResolvedValue(runtime)
    mocks.call.mockResolvedValue({ ok: true })
  })
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage(previousLanguage)
  })

  it('automatically connects only the fresh authorized requested runtime once', async () => {
    const onConnected = vi.fn()
    const view = render(<WebAccountConnect onConnected={onConnected} />)
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    view.rerender(<WebAccountConnect onConnected={(value) => onConnected(value)} />)
    expect(mocks.runtime).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.runtimes).not.toHaveBeenCalled()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(onConnected.mock.calls[0]![0].runtime.resourceVersion).toBe(9)
  })

  it('does not connect an unavailable or unauthorized target and leaves a retry', async () => {
    mocks.runtime.mockRejectedValue(new Error('not owned'))
    render(<WebAccountConnect onConnected={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法加载这台电脑'))
    expect(mocks.call).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
  })

  it('does not issue a connection when the requested runtime has no Relay path', async () => {
    mocks.runtime.mockResolvedValue({ ...runtime, connectionCapabilities: [] })
    render(<WebAccountConnect onConnected={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('没有可用连接路径'))
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

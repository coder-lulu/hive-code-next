import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY } from '../../../src/shared/mobile-desktop-relay-contract'
import { HostStatusGatesContext } from '../components/host-protocol-gates-context'
import { FakeSession } from '../transport/mobile-endpoint-supervisor-test-fakes'
import type { HostStatusGates } from '../transport/host-status-gates'
import type { RpcResponse } from '../transport/types'
import { MOBILE_TASKS_CAPABILITY } from './mobile-tasks-capability'
import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'

const desktopRef: { current: FakeSession | null } = { current: null }
/** The desktop's saved repo choice, as its settings answer it. */
const savedSelectionRef: { current: string[] } = { current: [] }
const savedSettingsRef: { current: Record<string, unknown> } = { current: {} }

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  StyleSheet: { create: <Styles,>(styles: Styles) => styles, hairlineWidth: 1 }
}))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => async () => {} }))
// The whole screen mounts; its surface only hands the finished model to the test.
const surface: { model?: ConnectionPresentationModel } = {}
vi.mock('./MobileTasksLegacySurface', () => ({
  MobileTasksLegacySurface: ({ model }: { model: ConnectionPresentationModel }) => {
    surface.model = model
    renders.push({
      loading: model.loading,
      refreshing: model.refreshing,
      count: model.items.length
    })
    return null
  }
}))
// The screen's barrel with its pure modules real; its native views and icons render nothing.
vi.mock('./mobile-tasks-dependencies', async () => {
  const react = await import('react')
  const pure = {
    useCallback: react.useCallback,
    useEffect: react.useEffect,
    useLayoutEffect: react.useLayoutEffect,
    useMemo: react.useMemo,
    useRef: react.useRef,
    useState: react.useState,
    StyleSheet: { create: <Styles,>(styles: Styles) => styles, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
    ...(await import('../theme/mobile-theme')),
    ...(await import('./use-host-repo-list')),
    ...(await import('./host-repo-list')),
    ...(await import('../../../src/shared/task-providers')),
    ...(await import('./hosted-repo-selection')),
    ...(await import('./mobile-work-items')),
    ...(await import('./github-work-item-source-errors')),
    ...(await import('./github-project-repo-match')),
    ...(await import('./github-project-reference')),
    ...(await import('./mobile-tasks-capability')),
    ...(await import('./setup-hook-trust')),
    ...(await import('./mobile-task-copy-feedback-timer')),
    ...(await import('./github-pr-file-diff')),
    ...(await import('./github-check-summary')),
    ...(await import('./gitlab-check-summary')),
    ...(await import('./mobile-hosted-check-status')),
    ...(await import('./workspace-create-params')),
    ...(await import('./workspace-agent-selection')),
    ...(await import('./hosted-review-start-point')),
    ...(await import('./mobile-workspace-name')),
    ...(await import('./sparse-preset-draft')),
    ...(await import('./workspace-ssh-gate')),
    ...(await import('./workspace-create-timeout')),
    ...(await import('./mobile-tui-agents')),
    ...(await import('./mobile-composer-branch-selection')),
    ...(await import('../transport/connection-health')),
    useHostClient: () => ({ client: desktopRef.current, state: desktopRef.current?.getState() }),
    useLocalSearchParams: () => ({ hostId: 'mac' }),
    useRouter: () => ({}),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useReconnectAttempt: () => 0,
    useLastConnectedAt: () => null,
    useRelayRecoveryStatus: () => null
  }
  const renderNothing = () => null
  const exports = new Map<string | symbol, unknown>(Object.entries(pure))
  return new Proxy(pure, {
    has: (target, key) => key !== 'then' && (key in target || typeof key === 'string'),
    get: (_target, key) =>
      exports.has(key) || typeof key !== 'string' || key === 'then'
        ? exports.get(key)
        : renderNothing
  })
})

const { MobileTasksScreen } = await import('./MobileTasksScreen')

type Sent = { method: string; params?: unknown; executionHost?: string }
const sentBy = new WeakMap<FakeSession, Sent[]>()

/** Records where each call ran, then answers it with `answer`. */
function recording(
  client: FakeSession,
  answer: (method: string, executionHost: string | undefined) => Promise<RpcResponse>
): FakeSession {
  const sent: Sent[] = []
  sentBy.set(client, sent)
  client.sendRequest.mockImplementation(
    async (
      method: string,
      params?: unknown,
      options?: { envelope?: { executionHost?: string } }
    ) => {
      sent.push({ method, params, executionHost: options?.envelope?.executionHost })
      return answer(method, options?.envelope?.executionHost)
    }
  )
  return client
}

function reply(result: unknown): RpcResponse {
  return { id: 'reply', ok: true, result, _meta: { runtimeId: 'runtime' } }
}

const MAC_REPOS = [{ id: 'mac-repo', displayName: 'app', path: '/mac/app' }]
const VM_REPOS = [
  { id: 'vm-repo', displayName: 'api', path: '/srv/api' },
  { id: 'vm-ssh-repo', displayName: 'remote', path: '/r', connectionId: 'vm-ssh' }
]
const HOSTS = [
  { hostId: 'runtime:vm', label: 'VM', health: 'available', relay: 'ready' },
  { hostId: 'runtime:old', label: 'ThinkPad', health: 'available', relay: 'update-needed' }
]

function issue(title: string) {
  return {
    id: title,
    type: 'issue',
    number: 1,
    title,
    state: 'open',
    url: 'https://github.com/o/r/issues/1',
    labels: [],
    updatedAt: '2026-10-11T00:00:00Z',
    author: null
  }
}

/** A desktop relaying to `runtime:vm`, whose repo list `vmRepoList` answers. */
function desktop(
  vmRepoList: () => Promise<unknown> = async () => ({ repos: VM_REPOS }),
  hostsList: () => Promise<unknown> = async () => ({ hosts: HOSTS }),
  jiraStatus: () => Promise<RpcResponse> = async () => reply({})
): FakeSession {
  return recording(new FakeSession('connected'), async (method, executionHost) => {
    if (method === 'jira.status') {
      return jiraStatus()
    }
    if (method === 'mobileRelay.hosts.list') {
      return reply(await hostsList())
    }
    if (method === 'status.get') {
      return reply({ capabilities: [MOBILE_TASKS_CAPABILITY] })
    }
    if (method === 'settings.get') {
      return reply({
        settings: { ...savedSettingsRef.current, defaultRepoSelection: savedSelectionRef.current }
      })
    }
    if (method === 'linear.status') {
      return reply({ connected: true })
    }
    if (method === 'linear.listIssues') {
      return reply([])
    }
    if (method === 'github.listWorkItems') {
      return reply({ items: [issue(executionHost ? 'from the server' : 'from the desktop')] })
    }
    if (method !== 'repo.list') {
      return reply({})
    }
    if (executionHost !== 'runtime:vm') {
      return reply({ repos: executionHost ? [] : MAC_REPOS })
    }
    return reply(await vmRepoList())
  })
}

/** What each render showed: the full-list spinner, and how many items. */
const renders: { loading: boolean; refreshing: boolean; count: number }[] = []
const mounted: ReactTestRenderer[] = []
afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => renderer.unmount())
  }
})

async function mount(
  client: FakeSession,
  hostCapabilities: string[],
  savedSelection: string[] = [],
  savedSettings: Record<string, unknown> = {}
): Promise<() => ConnectionPresentationModel> {
  desktopRef.current = client
  savedSelectionRef.current = savedSelection
  savedSettingsRef.current = savedSettings
  const gates: HostStatusGates = {
    hostCapabilities,
    floatingWorkspaceEnabled: false,
    desktopAppVersion: null,
    compatVerdict: { kind: 'ok' },
    hostProtocolWindow: { protocolVersion: undefined, minCompatibleMobileVersion: undefined },
    statusPending: false,
    statusReadable: true
  }
  await act(async () => {
    mounted.push(
      create(
        createElement(
          HostStatusGatesContext.Provider,
          { value: gates },
          createElement(MobileTasksScreen)
        )
      )
    )
  })
  return () => surface.model!
}

async function loadRepos(model: () => ConnectionPresentationModel): Promise<unknown> {
  const loaded: { repos?: unknown } = {}
  await act(async () => {
    loaded.repos = await model().repoListEnsureLoaded()
  })
  return loaded.repos
}

/** Lets the hosts feed and every answered server list land. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Where each call on the screen's client ran: its `executionHost`, or `desktop`. */
function ranOn(client: FakeSession, method: string): string[] {
  return (sentBy.get(client) ?? [])
    .filter((sent) => sent.method === method)
    .map((sent) => sent.executionHost ?? 'desktop')
}

describe('Tasks screen repos on the desktop and its servers', () => {
  it('hydrates other providers while Jira status is pending and ignores the previous host reply', async () => {
    const jiraStatus = deferred<RpcResponse>()
    const client = desktop(undefined, undefined, () => jiraStatus.promise)
    const model = await mount(client, [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY])
    await settle()
    expect(model().taskStateHydrated).toBe(true)
    expect(titles(model)).toContain('from the desktop')

    await act(async () => {
      desktopRef.current = desktop()
      model().setShowRepoPicker(true)
    })
    await settle()
    const nextConnection = model().jiraConnection
    jiraStatus.resolve(reply({ connected: true, sites: [] }))
    await settle()
    expect(model().jiraConnection).toEqual(nextConnection)
  })

  it('clears the previous desktop Jira connection while the next status is pending', async () => {
    const site = {
      id: 'desktop-a-site',
      siteUrl: 'https://a.atlassian.net',
      displayName: 'Desktop A',
      deployment: 'cloud' as const
    }
    const model = await mount(
      desktop(undefined, undefined, async () => reply({ connected: true, sites: [site] })),
      [],
      [],
      { defaultTaskSource: 'jira' }
    )
    await settle()
    expect(model().jiraConnection).toMatchObject({ connected: true, selection: site.id })
    const status = deferred<RpcResponse>()
    const nextDesktop = desktop(undefined, undefined, () => status.promise)
    await act(async () => {
      desktopRef.current = nextDesktop
      model().setShowRepoPicker(true)
    })
    await settle()
    expect(model().taskStateHydrated).toBe(true)
    expect(model().jiraConnection).toMatchObject({ connected: false, sites: [], selection: null })
    expect(ranOn(nextDesktop, 'jira.listIssues')).toEqual([])
    status.resolve(reply({ connected: false }))
    await settle()
  })

  it('keeps the newer explicit Jira status when an initial probe arrives late', async () => {
    const probe = deferred<RpcResponse>()
    let requests = 0
    const client = desktop(undefined, undefined, () => {
      requests += 1
      return requests === 1 ? probe.promise : Promise.resolve(reply({ connected: true }))
    })
    const model = await mount(client, [])
    await settle()
    await act(async () => {
      await model().refreshJiraConnection()
    })
    expect(model().jiraConnection.connected).toBe(true)
    probe.resolve(reply({ connected: false }))
    await settle()
    expect(model().jiraConnection.connected).toBe(true)
  })

  it('keeps the desktop list alone on a desktop that does not relay', async () => {
    const client = desktop()
    const model = await mount(client, [])
    await settle()
    expect(await loadRepos(model)).toEqual(MAC_REPOS)
    expect(ranOn(client, 'mobileRelay.hosts.list')).toEqual([])
    expect(ranOn(client, 'repo.list')).toEqual(['desktop'])
  })
})

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function titles(model: () => ConnectionPresentationModel): string[] {
  return model()
    .items.map((item) => item.title)
    .sort()
}

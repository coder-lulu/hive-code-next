// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import { projectHiveRuntimeAccountClaim } from '../../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { getDefaultSettings } from '../../../../shared/constants'
import { useAppStore } from '@/store'
import { TooltipProvider } from '../ui/tooltip'
import { RuntimeEnvironmentsPane } from './RuntimeEnvironmentsPane'
vi.mock('../ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    onSelect
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => <button onClick={onSelect}>{children}</button>
}))

vi.mock('./runtime-servers-page-context', () => ({
  useRuntimeServersPage: () => ({ dialog: null, setDialog: vi.fn() })
}))
vi.mock('./use-runtime-environment-catalog', () => ({
  useRuntimeEnvironmentCatalog: () => ({
    environments: [remote],
    isLoading: false,
    detailsByEnvironmentId: {},
    setDetailsByEnvironmentId: vi.fn(),
    mountedRef: { current: true },
    loadEnvironments: vi.fn(async () => {})
  })
}))
vi.mock('./use-managed-server-catalog', () => ({
  useManagedServerCatalog: () => ({
    api: null,
    pending: [],
    targets: [],
    resumingId: null,
    resume: vi.fn(),
    reload: vi.fn(async () => {})
  })
}))
vi.mock('./runtime-default-host-row', () => ({ RuntimeDefaultHostRow: () => null }))
vi.mock('./EphemeralVmRuntimesSection', () => ({ EphemeralVmRuntimesSection: () => null }))
vi.mock('./runtime-add-server-dialog', () => ({ RuntimeAddServerDialog: () => null }))
vi.mock('./runtime-install-server-dialog', () => ({ RuntimeInstallServerDialog: () => null }))
const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'runtime-1',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  ownershipEpoch: 1,
  cloudDisplayName: null,
  cloudDisplayNameVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  claimedAt: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: Date.now(),
  observedAt: Date.now(),
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
}

const directory: HiveAccountRuntimeDirectoryState = {
  status: 'READY',
  accountId: 'account-1',
  sessionGeneration: 1,
  items: [runtime],
  lastSyncedAt: Date.now(),
  errorCode: null
}

const ownership: HiveLocalRuntimeOwnershipState = {
  stateRevision: 1,
  relation: 'CLAIMED_BY_CURRENT',
  accountId: 'account-1',
  sessionGeneration: 1,
  runtimeRecordId: runtime.runtimeRecordId,
  ownershipEpoch: 1,
  claimCapabilityAvailable: false,
  presence: 'ONLINE',
  checkedAt: Date.now(),
  errorCode: null
}

const remote: PublicKnownRuntimeEnvironment = {
  id: 'remote',
  name: 'Remote cloud desk',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  runtimeId: null,
  endpoints: [],
  preferredEndpointId: 'cloud',
  accessSources: ['account-claimed'],
  accountClaim: projectHiveRuntimeAccountClaim({
    ...runtime,
    runtimeRecordId: 'remote-record',
    cloudDisplayName: 'Remote cloud desk'
  })
}
const initialState = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({
    accountRuntimeDirectory: directory,
    localRuntimeOwnership: ownership,
    refreshRemoteServerUpdates: vi.fn(async () => {})
  })
})
afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})
function renderPane() {
  render(
    <TooltipProvider>
      <RuntimeEnvironmentsPane
        settings={getDefaultSettings('/tmp')}
        setActiveRuntimeEnvironmentPreference={async () => true}
      />
    </TooltipProvider>
  )
}
it('opens the real local-computer alias dialog from the current Pane and fences session replacement', async () => {
  renderPane()
  fireEvent.click(screen.getByRole('button', { name: 'Rename current computer in HiveCloud' }))
  expect(screen.getByRole('dialog', { name: 'Rename Runtime' })).toBeTruthy()
  act(() =>
    useAppStore.setState({ accountRuntimeDirectory: { ...directory, sessionGeneration: 2 } })
  )
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename Runtime' })).toBeNull())
})
it('passes cloud rename through the real ServerList and Row to the account dialog', () => {
  renderPane()
  fireEvent.click(screen.getByRole('button', { name: 'Rename HiveCloud Runtime' }))
  expect(screen.getByRole('textbox', { name: 'Runtime name' })).toHaveValue('Remote cloud desk')
})

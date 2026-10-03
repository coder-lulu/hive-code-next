// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentInstallationDetails } from './AgentInstallationDetails'
import type { AgentInstallationReport } from '../../../../shared/agent-installation-types'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
const original = window.api
const read = vi.fn()
const upgrade = vi.fn()
const target = { environmentId: null, platform: 'win32', wslDistro: null }
const report: AgentInstallationReport = {
  status: 'ready',
  conflict: true,
  truncated: false,
  installations: [
    {
      path: 'C:\\tools\\codex.cmd',
      command: 'C:\\tools\\codex.cmd',
      realPath: 'C:\\tools\\codex.js',
      source: 'npm',
      version: '1.0.0',
      health: 'ready',
      isActive: true,
      isDefault: true,
      canUpgrade: true
    },
    {
      path: 'C:\\broken\\codex.cmd',
      command: 'C:\\broken\\codex.cmd',
      realPath: 'C:\\broken\\codex.js',
      source: 'unknown',
      version: null,
      health: 'broken',
      isActive: false,
      isDefault: false,
      canUpgrade: false
    }
  ]
}
beforeEach(() => {
  vi.clearAllMocks()
  read.mockResolvedValue(report)
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: { preflight: { readAgentInstallations: read } }
  })
})
afterEach(() => {
  cleanup()
  window.api = original
})

it('shows conflicts, active paths and broken installations and upgrades the displayed target', async () => {
  render(<AgentInstallationDetails agent="codex" target={target} onUpgrade={upgrade} />)
  await screen.findByText('Used by HiveCode')
  expect(screen.getByText('Unable to run')).toBeTruthy()
  expect(screen.getByText(/Multiple installations/)).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Upgrade this installation' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade this installation' }))
  expect(upgrade).toHaveBeenCalledWith(report.installations[0])
})

it('queries the remote owner and never invokes the local bridge', async () => {
  rpc.mockResolvedValue(report)
  render(
    <AgentInstallationDetails
      agent="codex"
      target={{ ...target, environmentId: 'remote' }}
      onUpgrade={upgrade}
    />
  )
  await screen.findByText('Used by HiveCode')
  expect(rpc).toHaveBeenCalledWith(
    { kind: 'environment', environmentId: 'remote' },
    'preflight.readAgentInstallations',
    expect.anything(),
    expect.anything()
  )
  expect(read).not.toHaveBeenCalled()
})

it('keeps remote failure unavailable instead of substituting local results', async () => {
  rpc.mockRejectedValue(new Error('disconnected'))
  render(
    <AgentInstallationDetails
      agent="codex"
      target={{ ...target, environmentId: 'remote' }}
      onUpgrade={upgrade}
    />
  )
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Upgrade this installation' })).toBeNull()
  expect(read).not.toHaveBeenCalled()
})

it('ignores a late reply from the previous environment', async () => {
  let finish!: (value: AgentInstallationReport) => void
  read.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  rpc.mockResolvedValue({ ...report, installations: [], conflict: false })
  const view = render(
    <AgentInstallationDetails agent="codex" target={target} onUpgrade={upgrade} />
  )
  await waitFor(() => expect(read).toHaveBeenCalledOnce())
  view.rerender(
    <AgentInstallationDetails
      agent="codex"
      target={{ ...target, environmentId: 'remote' }}
      onUpgrade={upgrade}
    />
  )
  await screen.findByText('No installation paths were found in this environment.')
  await act(async () => finish(report))
  expect(screen.queryByText('Used by HiveCode')).toBeNull()
})

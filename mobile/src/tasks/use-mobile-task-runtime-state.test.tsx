import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { HostCatalogEntry } from '../transport/types'
import { useMobileTaskRuntimeState } from './use-mobile-task-runtime-state'

const state = vi.hoisted<{
  loaded: boolean
  directoryStatus: string
  catalog: HostCatalogEntry[]
}>(() => ({
  loaded: true,
  directoryStatus: 'ready',
  catalog: []
}))
vi.mock('../runtime-directory/use-account-visible-host-catalog', () => ({
  useAccountVisibleHostCatalog: () => state
}))
vi.mock('../runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({ state: { status: state.directoryStatus } })
}))
let renderer: ReactTestRenderer | null = null
afterEach(() => act(() => renderer?.unmount()))

function catalogEntry(overrides: Partial<HostCatalogEntry>): HostCatalogEntry {
  return {
    id: 'runtime',
    name: 'Runtime',
    endpoint: 'cloud://runtime',
    publicKeyB64: '',
    lastConnected: 0,
    profile: null,
    credentialStatus: 'cloud-unavailable',
    ...overrides
  }
}

it('follows the selected Runtime directory evidence through loading, availability and offline', () => {
  let result = ''
  function Probe() {
    result = useMobileTaskRuntimeState('selected', {
      connectionState: 'disconnected',
      tasksSupported: false,
      tasksUnsupported: false
    })
    return null
  }
  state.directoryStatus = 'loading'
  act(() => {
    renderer = create(createElement(Probe))
  })
  expect(result).toBe('loading')
  state.directoryStatus = 'ready'
  state.catalog = [
    catalogEntry({ id: 'other', accountPresence: 'OFFLINE', credentialStatus: 'cloud-offline' })
  ]
  act(() => renderer!.update(createElement(Probe)))
  expect(result).toBe('disconnected')
  state.catalog.push(
    catalogEntry({
      id: 'selected',
      accountPresence: 'ONLINE',
      credentialStatus: 'cloud-unavailable'
    })
  )
  act(() => renderer!.update(createElement(Probe)))
  expect(result).toBe('unavailable')
  state.catalog[1] = {
    ...state.catalog[1]!,
    accountPresence: 'OFFLINE',
    credentialStatus: 'cloud-offline'
  }
  act(() => renderer!.update(createElement(Probe)))
  expect(result).toBe('offline')
})

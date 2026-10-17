import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcRenderer: { invoke: vi.fn(), on: vi.fn() } }))
import { getWslHostsApi } from './wsl-hosts-api'

describe('WSL hosts preload API', () => {
  it('exposes Windows capability discovery without an internal opt-in', () => {
    expect(getWslHostsApi({}, 'win32')).toBeDefined()
    expect(getWslHostsApi({ ORCA_INTERNAL_WSL_HOSTS: '' }, 'win32')).toBeDefined()
  })
  it('keeps unsupported production platforms unavailable', () => {
    expect(getWslHostsApi({}, 'darwin')).toBeUndefined()
    expect(getWslHostsApi({ ORCA_INTERNAL_WSL_HOSTS: '1' }, 'linux')).toBeUndefined()
  })
  it('retains the explicit fake-host test seam', () => {
    expect(getWslHostsApi({ ORCA_E2E_FAKE_WSL_HOSTS: '{}' }, 'linux')).toBeDefined()
  })
})

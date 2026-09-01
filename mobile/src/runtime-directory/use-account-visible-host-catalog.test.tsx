import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostCatalogEntry } from '../transport/types'
import { useAccountVisibleHostCatalog } from './use-account-visible-host-catalog'

let mergeCatalog: (local: readonly HostCatalogEntry[]) => HostCatalogEntry[]
const loadHostCatalog = vi.fn<() => Promise<HostCatalogEntry[]>>()

vi.mock('./account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({ mergeCatalog })
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: () => loadHostCatalog() }))

const localEntry = (id: string): HostCatalogEntry => ({
  id,
  name: id,
  endpoint: `ws://${id}`,
  publicKeyB64: 'key',
  lastConnected: 1,
  credentialStatus: 'missing',
  profile: null
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useAccountVisibleHostCatalog', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ReturnType<typeof useAccountVisibleHostCatalog> | null = null

  function Probe() {
    latest = useAccountVisibleHostCatalog()
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    renderer?.unmount()
    renderer = null
    latest = null
    mergeCatalog = (local) => [...local]
  })

  it('reloads when a late account directory becomes visible', async () => {
    loadHostCatalog.mockResolvedValue([localEntry('local')])
    await act(async () => {
      renderer = create(createElement(Probe))
    })
    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local'])

    mergeCatalog = (local) => [...local, localEntry('account')]
    await act(async () => {
      renderer?.update(createElement(Probe))
    })
    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local', 'account'])
  })

  it('switches account overlays immediately without re-reading the local catalog', async () => {
    loadHostCatalog.mockResolvedValueOnce([localEntry('local')])
    mergeCatalog = (local) => [...local, localEntry('old-account')]
    await act(async () => {
      renderer = create(createElement(Probe))
    })
    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local', 'old-account'])

    mergeCatalog = (local) => [...local, localEntry('new-account')]
    await act(async () => {
      renderer?.update(createElement(Probe))
    })

    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local', 'new-account'])
    expect(loadHostCatalog).toHaveBeenCalledOnce()
  })

  it('does not let an older account load overwrite the current account catalog', async () => {
    loadHostCatalog.mockResolvedValueOnce([localEntry('local')])
    await act(async () => {
      renderer = create(createElement(Probe))
    })

    const first = deferred<HostCatalogEntry[]>()
    const second = deferred<HostCatalogEntry[]>()
    loadHostCatalog.mockReset()
    loadHostCatalog.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mergeCatalog = (local) => [...local, localEntry('old-account')]
    act(() => {
      renderer?.update(createElement(Probe))
    })
    let firstReload!: Promise<HostCatalogEntry[]>
    act(() => {
      firstReload = latest!.reload()
    })

    mergeCatalog = (local) => [...local, localEntry('new-account')]
    act(() => {
      renderer?.update(createElement(Probe))
    })
    let secondReload!: Promise<HostCatalogEntry[]>
    act(() => {
      secondReload = latest!.reload()
    })
    await act(async () => {
      second.resolve([localEntry('local')])
      await secondReload
    })
    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local', 'new-account'])

    await act(async () => {
      first.resolve([localEntry('local')])
      await firstReload
    })
    expect(latest?.catalog.map(({ id }) => id)).toEqual(['local', 'new-account'])
  })

  it('returns the current account overlay when the account changes during reload', async () => {
    loadHostCatalog.mockResolvedValueOnce([localEntry('local')])
    await act(async () => {
      renderer = create(createElement(Probe))
    })

    const pending = deferred<HostCatalogEntry[]>()
    loadHostCatalog.mockReturnValueOnce(pending.promise)
    mergeCatalog = (local) => [...local, localEntry('old-account')]
    act(() => {
      renderer?.update(createElement(Probe))
    })
    let reload!: Promise<HostCatalogEntry[]>
    act(() => {
      reload = latest!.reload()
    })

    mergeCatalog = (local) => [...local, localEntry('new-account')]
    act(() => {
      renderer?.update(createElement(Probe))
    })
    let returned: HostCatalogEntry[] = []
    await act(async () => {
      pending.resolve([localEntry('local')])
      returned = await reload
    })

    expect(returned.map(({ id }) => id)).toEqual(['local', 'new-account'])
  })
})

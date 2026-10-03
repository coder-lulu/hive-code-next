import { describe, expect, it, vi } from 'vitest'
import { HiveAiModelReader } from './hive-ai-model-reader'
import { accountModelCatalogFixture as catalog } from '../../shared/hive-ai-model-catalog.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'

const command = {
  modelId: 'model-b',
  protocol: 'RESPONSES',
  snapshotRevision: catalog.snapshotRevision
}
function fixture() {
  let auth: HiveRuntimeCloudAuthorization | null = {
    accountId: 'owner-a',
    authorityId: 'authority',
    sessionGeneration: 1,
    accessToken: 'private-hive-token',
    sessionExpiresAt: Date.now() + 60_000
  }
  let origin = 'https://cloud.example.test'
  const listeners = new Set<() => void>()
  const client = { catalog: vi.fn().mockResolvedValue(catalog) }
  const reader = new HiveAiModelReader(
    {
      getRuntimeCloudAuthorization: () => auth,
      subscribeRuntimeCloudAuthorization: (listener) => {
        const notify = () => listener(auth)
        listeners.add(notify)
        return () => {
          listeners.delete(notify)
        }
      }
    },
    () => ({
      configured: true,
      config: { apiBaseUrl: origin, userLoginUrl: '', identityIssuer: '', clientId: '', scope: '' }
    }),
    () => client
  )
  return {
    reader,
    client,
    listeners,
    replace: (accountId = 'owner-a') => {
      auth = {
        ...auth!,
        accountId,
        sessionGeneration: auth!.sessionGeneration + 1,
        accessToken: 'rotated-private-token'
      }
      listeners.forEach((notify) => notify())
    },
    signOut: () => {
      auth = null
      listeners.forEach((notify) => notify())
    },
    changeOrigin: () => {
      origin = 'https://different-cloud.example.test'
    }
  }
}
describe('desktop current-account model selection', () => {
  it('reads without defaults, coalesces the query and keeps the Hive credential out of results', async () => {
    const { reader, client, listeners } = fixture()
    const [first, second] = await Promise.all([reader.read(), reader.read()])
    expect(first).toEqual({ accountId: 'owner-a', catalog, selection: null })
    expect(second).toEqual(first)
    expect(client.catalog).toHaveBeenCalledOnce()
    expect(JSON.stringify(first)).not.toContain('private-hive-token')
    expect(listeners.size).toBe(0)
  })
  it('re-reads before selecting and returns independent preferences', async () => {
    const { reader, client } = fixture()
    await reader.read()
    const selected = await reader.select(command)
    expect(selected.selection).toEqual(command)
    expect(client.catalog).toHaveBeenCalledTimes(2)
    selected.selection!.modelId = 'poison'
    expect((await reader.read()).selection).toEqual(command)
  })
  it('rejects identity, key or gateway parameters without querying', async () => {
    const { reader, client } = fixture()
    for (const data of [
      { ...command, accountId: 'other' },
      { ...command, key: 'SECRET' },
      { ...command, origin: 'https://other.test' },
      { ...command, protocol: 'IMAGE' }
    ]) {
      await expect(reader.select(data)).rejects.toThrow('invalid_model_selection')
    }
    expect(client.catalog).not.toHaveBeenCalled()
  })
  it.each([
    { ...catalog, snapshotRevision: 'b'.repeat(64) },
    { ...catalog, models: [] },
    {
      ...catalog,
      models: [
        {
          modelId: 'model-b',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          protocols: ['CHAT_COMPLETIONS']
        }
      ]
    }
  ])('rejects stale, removed or incompatible selection after re-reading', async (changed) => {
    const { reader, client } = fixture()
    await reader.select(command)
    client.catalog.mockResolvedValue(changed)
    await expect(reader.select(command)).rejects.toThrow('unavailable')
    expect((await reader.read()).selection).toBeNull()
  })
  it('clears preferences after session refresh, account change or Cloud origin change', async () => {
    const { reader, replace, changeOrigin } = fixture()
    await reader.select(command)
    replace()
    expect((await reader.read()).selection).toBeNull()
    await reader.select(command)
    replace('owner-b')
    expect((await reader.read()).selection).toBeNull()
    await reader.select(command)
    changeOrigin()
    expect((await reader.read()).selection).toBeNull()
  })
  it('clears preferences on a failed read and does not silently restore them on recovery', async () => {
    const { reader, client } = fixture()
    await reader.select(command)
    client.catalog.mockRejectedValueOnce(new Error('unavailable'))
    await expect(reader.read()).rejects.toThrow('unavailable')
    expect((await reader.read()).selection).toBeNull()
  })
  it('does not share two distinct in-flight choices for the same login', async () => {
    const { reader, client } = fixture()
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const pending = reader.select(command)
    await expect(reader.select({ ...command, protocol: 'CHAT_COMPLETIONS' })).rejects.toThrow(
      'busy'
    )
    release(catalog)
    expect((await pending).selection).toEqual(command)
    expect(client.catalog).toHaveBeenCalledOnce()
  })
  it('rejects an old pending read without reusing it for the selection refresh', async () => {
    const { reader, client } = fixture()
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const old = expect(reader.read()).rejects.toThrow('unavailable')
    await reader.select(command)
    expect((await reader.read()).selection).toEqual(command)
    release(catalog)
    await old
    expect((await reader.read()).selection).toEqual(command)
  })
  it('isolates an old pending selection while permitting the new owner to select immediately', async () => {
    const { reader, client, replace, listeners } = fixture()
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const old = expect(reader.select(command)).rejects.toThrow('unavailable')
    replace('owner-b')
    expect((await reader.select(command)).accountId).toBe('owner-b')
    release(catalog)
    await old
    expect((await reader.read()).selection).toEqual(command)
    expect(listeners.size).toBe(0)
  })
  it.each(['failure', 'changed-revision'])(
    'isolates a read started during selection when its late result is %s',
    async (lateResult) => {
      const { reader, client, listeners } = fixture()
      let completeChoice!: (value: typeof catalog) => void
      let completeRead!: (value: typeof catalog) => void
      let failRead!: (error: Error) => void
      client.catalog.mockReturnValueOnce(
        new Promise((resolve) => {
          completeChoice = resolve
        })
      )
      client.catalog.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          completeRead = resolve
          failRead = reject
        })
      )
      const choice = reader.select(command)
      const lateRead = reader.read().then(
        () => null,
        (error: Error) => error
      )
      completeChoice(catalog)
      expect((await choice).selection).toEqual(command)
      const refreshed = reader.read().catch(() => null)
      const refreshRequestCount = client.catalog.mock.calls.length
      if (lateResult === 'failure') {
        failRead(new Error('unavailable'))
      } else {
        completeRead({ ...catalog, snapshotRevision: 'b'.repeat(64) })
      }
      const lateError = await lateRead
      const refreshedView = await refreshed
      expect(refreshRequestCount).toBe(3)
      expect(lateError?.message).toContain('unavailable')
      expect(refreshedView?.selection).toEqual(command)
      expect((await reader.read()).selection).toEqual(command)
      expect(listeners.size).toBe(0)
    }
  )
  it('rejects logged-out reads or choices without dispatching any request', async () => {
    const { reader, client, signOut } = fixture()
    signOut()
    await expect(reader.read()).rejects.toThrow('unavailable')
    await expect(reader.select(command)).rejects.toThrow('unavailable')
    expect(client.catalog).not.toHaveBeenCalled()
  })
  it('resolves explicit Generation choices without replacing the login preference', async () => {
    const { reader, client, listeners } = fixture()
    await reader.select(command)
    const choice = { ...command, modelId: 'vendor/model-a', protocol: 'CHAT_COMPLETIONS' as const }
    const resolved = await reader.resolveForGeneration(choice, 'owner-a')
    expect(resolved.selection).toEqual(choice)
    expect(Object.isFrozen(resolved.selection)).toBe(true)
    expect(client.catalog).toHaveBeenCalledTimes(2)
    expect(listeners.size).toBe(0)
    expect((await reader.read()).selection).toEqual(command)
    expect(JSON.stringify(resolved)).not.toContain('private-hive-token')
    expect(() => resolved.assertCurrent()).not.toThrow()
  })
  it.each(['owner', 'logout', 'refresh', 'origin'])(
    'rejects a retained Generation resolution after %s changes',
    async (change) => {
      const { reader, replace, signOut, changeOrigin } = fixture()
      const resolved = await reader.resolveForGeneration(command, 'owner-a')
      if (change === 'logout') {
        signOut()
      } else if (change === 'origin') {
        changeOrigin()
      } else {
        replace(change === 'owner' ? 'owner-b' : 'owner-a')
      }
      expect(() => resolved.assertCurrent()).toThrow('unavailable')
    }
  )
  it('rejects a different principal account before any Generation catalog query', async () => {
    const { reader, client } = fixture()
    await expect(reader.resolveForGeneration(command, 'owner-b')).rejects.toThrow('unavailable')
    expect(client.catalog).not.toHaveBeenCalled()
    await expect(
      reader.resolveForGeneration({ ...command, owner: 'owner-a' }, 'owner-a')
    ).rejects.toThrow('invalid_model_selection')
    expect(client.catalog).not.toHaveBeenCalled()
  })
  it.each([
    { ...catalog, snapshotRevision: 'b'.repeat(64) },
    { ...catalog, models: [] },
    {
      ...catalog,
      models: [
        {
          modelId: 'model-b',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          protocols: ['CHAT_COMPLETIONS']
        }
      ]
    }
  ])('rejects stale or unavailable Generation model choices', async (changed) => {
    const { reader, client } = fixture()
    client.catalog.mockResolvedValueOnce(changed)
    await expect(reader.resolveForGeneration(command, 'owner-a')).rejects.toThrow('unavailable')
  })
  it('rejects a late Generation lookup after account change', async () => {
    const { reader, client, replace, listeners } = fixture()
    let release!: (value: typeof catalog) => void
    client.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const pending = expect(reader.resolveForGeneration(command, 'owner-a')).rejects.toThrow(
      'unavailable'
    )
    replace('owner-b')
    release(catalog)
    await pending
    expect(listeners.size).toBe(0)
  })
})

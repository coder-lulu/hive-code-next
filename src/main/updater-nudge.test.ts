import { beforeEach, describe, expect, it, vi } from 'vitest'

const { defaultNetFetchMock, fromPartitionMock, netFetchMock } = vi.hoisted(() => ({
  defaultNetFetchMock: vi.fn(),
  fromPartitionMock: vi.fn(),
  netFetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: defaultNetFetchMock },
  session: { fromPartition: fromPartitionMock }
}))

vi.mock('./product/product-external-service-endpoints', () => ({
  getProductExternalServiceEndpoints: () => ({
    feedback: null,
    pluginKillList: null,
    changelog: null,
    nudge: 'https://onorca.dev/whats-new/nudge.json'
  })
}))

import { fetchNudge, versionMatchesRange, shouldApplyNudge } from './updater-nudge'
import { isRolloutFlagActive, resetRolloutConfigForTests } from './updater/rollout-flags'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body))
  } as unknown as Response
}

describe('updater-nudge', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    defaultNetFetchMock.mockReset()
    defaultNetFetchMock.mockImplementation((...args: unknown[]) => netFetchMock(...args))
    fromPartitionMock.mockReset()
    fromPartitionMock.mockReturnValue({ fetch: netFetchMock })
    resetRolloutConfigForTests()
  })

  describe('fetchNudge', () => {
    it('uses the isolated electron-updater session instead of default net.fetch', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({}))

      await expect(fetchNudge()).resolves.toBeNull()

      expect(fromPartitionMock).toHaveBeenCalledWith('electron-updater', { cache: false })
      expect(defaultNetFetchMock).not.toHaveBeenCalled()
    })

    it('returns a valid config for a well-formed response', async () => {
      netFetchMock.mockResolvedValue(
        jsonResponse({ id: 'campaign-1', minVersion: '1.1.0', maxVersion: '1.1.19' })
      )

      const result = await fetchNudge()
      expect(netFetchMock).toHaveBeenCalledWith(
        'https://onorca.dev/whats-new/nudge.json',
        expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
      )
      expect(result).toEqual({ id: 'campaign-1', minVersion: '1.1.0', maxVersion: '1.1.19' })
    })

    it('returns a valid config with only maxVersion', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ id: 'campaign-2', maxVersion: '1.1.19' }))

      const result = await fetchNudge()
      expect(result).toEqual({ id: 'campaign-2', maxVersion: '1.1.19' })
    })

    it('returns null for an empty response', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({}))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null for a null response', async () => {
      netFetchMock.mockResolvedValue(jsonResponse(null))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null on non-ok HTTP response', async () => {
      const cancel = vi.fn(() => Promise.resolve())
      netFetchMock.mockResolvedValue({ ok: false, body: { cancel } })

      await expect(fetchNudge()).resolves.toBeNull()
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('returns null on network error', async () => {
      netFetchMock.mockRejectedValue(new Error('network down'))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('trims whitespace from the campaign id', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ id: '  campaign-1  ', minVersion: '1.0.0' }))

      const result = await fetchNudge()
      expect(result?.id).toBe('campaign-1')
    })

    it('returns null when id is missing', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ minVersion: '1.0.0' }))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when neither version endpoint is present', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ id: 'campaign-1' }))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when minVersion is invalid', async () => {
      netFetchMock.mockResolvedValue(
        jsonResponse({ id: 'campaign-1', minVersion: 'not-a-version' })
      )

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when maxVersion is invalid', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ id: 'campaign-1', maxVersion: 'wat' }))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when the configured range is inverted', async () => {
      netFetchMock.mockResolvedValue(
        jsonResponse({
          id: 'campaign-1',
          minVersion: '1.2.0',
          maxVersion: '1.1.0'
        })
      )

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('rejects an oversized nudge response before reading its body', async () => {
      const text = vi.fn(() => Promise.resolve('{}'))
      const cancel = vi.fn(() => Promise.resolve())
      netFetchMock.mockResolvedValue({
        ok: true,
        headers: { get: () => String(64 * 1024 + 1) },
        body: { cancel },
        text
      } as unknown as Response)

      await expect(fetchNudge()).resolves.toBeNull()
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(text).not.toHaveBeenCalled()
    })
  })

  describe('rollout block on the same request', () => {
    const install = { appVersion: '1.5.0', installId: 'install-a' }
    const killSwitch = { version: 1, flags: { 'pinned-relay-default': { state: 'on' } } }

    it('records the block without changing the nudge it rides on', async () => {
      netFetchMock.mockResolvedValue(
        jsonResponse({ id: 'campaign-1', minVersion: '1.0.0', rollout: killSwitch })
      )

      await expect(fetchNudge()).resolves.toEqual({ id: 'campaign-1', minVersion: '1.0.0' })
      expect(isRolloutFlagActive('pinned-relay-default', install)).toBe(true)
      expect(netFetchMock).toHaveBeenCalledTimes(1)
    })

    it('reads a block even when there is no nudge campaign', async () => {
      netFetchMock.mockResolvedValue(jsonResponse({ rollout: killSwitch }))

      await expect(fetchNudge()).resolves.toBeNull()
      expect(isRolloutFlagActive('pinned-relay-default', install)).toBe(true)
    })

    it('keeps the last block when a later request fails', async () => {
      netFetchMock.mockResolvedValueOnce(jsonResponse({ rollout: killSwitch }))
      await fetchNudge()
      netFetchMock.mockResolvedValueOnce({ ok: false })
      await fetchNudge()
      netFetchMock.mockRejectedValueOnce(new Error('network down'))
      await fetchNudge()

      expect(isRolloutFlagActive('pinned-relay-default', install)).toBe(true)
    })
  })

  describe('versionMatchesRange', () => {
    it('bounded range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.19', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        true
      )
      expect(versionMatchesRange('1.0.9', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
      expect(versionMatchesRange('1.2.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
    })

    it('upper-only range match', () => {
      expect(versionMatchesRange('1.1.5', { maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.2.0', { maxVersion: '1.1.19' })).toBe(false)
    })

    it('lower-only range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0' })).toBe(true)
      expect(versionMatchesRange('1.0.0', { minVersion: '1.1.0' })).toBe(false)
    })
  })

  describe('shouldApplyNudge', () => {
    const nudge = { id: 'campaign-1', minVersion: '1.0.0' }

    it('returns true when version matches and not dismissed/pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(true)
    })

    it('returns false when campaign already dismissed', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: 'campaign-1'
        })
      ).toBe(false)
    })

    it('returns false when campaign is already pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: 'campaign-1',
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })

    it('returns false when version does not match', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '0.9.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })
  })
})

// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  type HiveAccountRuntimeDirectoryState
} from '../../../../shared/hive-runtime-cloud'
import { createSliceStore } from './account-runtime-cloud-test-store'

describe('account Runtime display-name IPC publication', () => {
  it('applies a display-name IPC result and reloads the projected catalog', async () => {
    const updated: HiveAccountRuntimeDirectoryState = {
      ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      status: 'READY',
      accountId: 'account-1',
      sessionGeneration: 1,
      pendingDisplayNames: [
        {
          runtimeRecordId: 'runtime-1',
          desiredName: 'Queued name',
          revision: 1,
          status: 'QUEUED',
          expectedOwnershipEpoch: 1,
          expectedCloudDisplayNameVersion: 1,
          errorCode: null,
          latestCloudDisplayName: null,
          latestCloudDisplayNameVersion: null,
          confirmedCloudDisplayNameVersion: null,
          retryNotBefore: null
        }
      ]
    }
    const updateDisplayName = vi.fn().mockResolvedValue(updated)
    const list = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: { updateDisplayName }
      }
    })
    const store = createSliceStore()

    await store.getState().updateAccountRuntimeDisplayName({
      runtimeRecordId: 'runtime-1',
      cloudDisplayName: 'Queued name',
      expectedCloudDisplayNameVersion: 1,
      expectedOwnershipEpoch: 1
    })

    expect(store.getState().accountRuntimeDirectory).toBe(updated)
    expect(updateDisplayName).toHaveBeenCalledWith({
      runtimeRecordId: 'runtime-1',
      cloudDisplayName: 'Queued name',
      expectedCloudDisplayNameVersion: 1,
      expectedOwnershipEpoch: 1
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
  })
})

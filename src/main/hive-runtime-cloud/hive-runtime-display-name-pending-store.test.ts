import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import { createHiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator-factory'
import {
  HiveRuntimeDisplayNamePendingStore,
  MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES,
  MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES,
  MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES,
  type DesktopPendingDisplayNameState,
  type DesktopPendingRuntimeDisplayName
} from './hive-runtime-display-name-pending-store'

const temporaryDirectories: string[] = []
const authorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  accessToken: 'token',
  sessionGeneration: 1,
  sessionExpiresAt: 10_000
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('HiveRuntimeDisplayNamePendingStore', () => {
  it('persists the maximum worst-case scoped queue below its dedicated JSON limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-runtime-display-name-'))
    temporaryDirectories.push(root)
    const store = new HiveRuntimeDisplayNamePendingStore(root)
    const state: DesktopPendingDisplayNameState = {
      schemaVersion: 1,
      nextRevision: Number.MAX_SAFE_INTEGER,
      tasks: Array.from(
        {
          length:
            MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES * MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES
        },
        (_, index) =>
          maximumSizeTask(index, Math.floor(index / MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES))
      )
    }

    expect(() => store.save(state)).not.toThrow()
    expect(store.load()).toEqual(state)
    const persistedBytes = statSync(
      join(root, 'hive-runtime-cloud', 'display-name-pending.v1.json')
    ).size
    expect(persistedBytes).toBeGreaterThan(16_384)
    expect(persistedBytes).toBeLessThanOrEqual(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES)
  })

  it('rejects a new target at capacity without discarding old tasks', () => {
    let state: DesktopPendingDisplayNameState = {
      schemaVersion: 1,
      nextRevision: 1,
      tasks: []
    }
    const coordinator = new HiveRuntimeDisplayNameCoordinator(
      {
        load: () => state,
        save: (next) => {
          state = next
        }
      },
      {
        getOwnedRuntime: vi.fn(),
        updateOwnedRuntimeDisplayName: vi.fn().mockRejectedValue(new Error('offline'))
      },
      () => 1_000,
      vi.fn(),
      vi.fn()
    )
    coordinator.setAuthorization(authorization)

    for (let index = 0; index < MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES; index += 1) {
      coordinator.enqueue({
        runtimeRecordId: runtimeId(index),
        desiredName: `Desk ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }

    expect(() =>
      coordinator.enqueue({
        runtimeRecordId: runtimeId(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES),
        desiredName: 'Overflow',
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    ).toThrow('hive_runtime_display_name_pending_capacity')

    expect(state.tasks).toHaveLength(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES)
    expect(state.tasks.map((task) => task.runtimeRecordId)).toEqual(
      Array.from({ length: MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES }, (_, index) => runtimeId(index))
    )

    expect(() =>
      coordinator.enqueue({
        runtimeRecordId: runtimeId(0),
        desiredName: 'Latest first target',
        expectedCloudDisplayNameVersion: 2,
        expectedResourceVersion: 1
      })
    ).not.toThrow()
    expect(state.tasks).toHaveLength(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES)
    expect(state.tasks.at(-1)).toMatchObject({
      runtimeRecordId: runtimeId(0),
      desiredName: 'Latest first target'
    })
  })

  it('gives each authority and account scope an independent capacity quota', () => {
    let state: DesktopPendingDisplayNameState = {
      schemaVersion: 1,
      nextRevision: 1,
      tasks: []
    }
    const coordinator = new HiveRuntimeDisplayNameCoordinator(
      {
        load: () => state,
        save: (next) => {
          state = next
        }
      },
      {
        getOwnedRuntime: vi.fn(),
        updateOwnedRuntimeDisplayName: vi.fn().mockRejectedValue(new Error('offline'))
      },
      () => 1_000,
      vi.fn(),
      vi.fn()
    )
    coordinator.setAuthorization(authorization)
    for (let index = 0; index < MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES; index += 1) {
      coordinator.enqueue({
        runtimeRecordId: runtimeId(index),
        desiredName: `Account A ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }

    coordinator.setAuthorization({
      ...authorization,
      accountId: '323e4567-e89b-42d3-a456-426614174000',
      accessToken: 'token-b',
      sessionGeneration: 2
    })

    expect(() =>
      coordinator.enqueue({
        runtimeRecordId: runtimeId(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES),
        desiredName: 'Account B desk',
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    ).not.toThrow()
    expect(state.tasks).toHaveLength(MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES + 1)
  })

  it('fails closed on an unreadable queue without breaking the directory service startup path', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-runtime-display-name-'))
    temporaryDirectories.push(root)
    const queueDirectory = join(root, 'hive-runtime-cloud')
    const queuePath = join(queueDirectory, 'display-name-pending.v1.json')
    mkdirSync(queueDirectory, { recursive: true })
    writeFileSync(queuePath, '{corrupt-json', 'utf8')

    const coordinator = createHiveRuntimeDisplayNameCoordinator({
      client: {
        getOwnedRuntime: async () => {
          throw new Error('not called')
        },
        updateOwnedRuntimeDisplayName: async () => {
          throw new Error('not called')
        }
      },
      userDataPath: root,
      now: () => 1_000,
      onChanged: vi.fn(),
      requestDirectoryRefresh: vi.fn()
    })

    expect(coordinator).toBeNull()
    expect(readFileSync(queuePath, 'utf8')).toBe('{corrupt-json')
  })
})

function maximumSizeTask(index: number, scopeIndex: number): DesktopPendingRuntimeDisplayName {
  return {
    authorityId: '\ud800'.repeat(128),
    accountId: `${'\ud800'.repeat(127)}${scopeIndex}`,
    runtimeRecordId: runtimeId(index),
    desiredName: '😀'.repeat(128),
    expectedCloudDisplayNameVersion: Number.MAX_SAFE_INTEGER,
    expectedResourceVersion: Number.MAX_SAFE_INTEGER,
    revision: Number.MAX_SAFE_INTEGER - index,
    dormant: false,
    confirmed: true,
    confirmedCloudDisplayNameVersion: Number.MAX_SAFE_INTEGER
  }
}

function runtimeId(index: number): string {
  return `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`
}

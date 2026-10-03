import { hivecodeProductConfig } from '../../shared/generated/product-config'
import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL,
  HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeClaimRequest,
  type HiveLocalRuntimeOwnershipState,
  type HiveRuntimeDisplayNameUpdateRequest,
  type HiveRuntimeSessionRevokeRequest
} from '../../shared/hive-runtime-cloud'
import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import type { HiveAccountRuntimeDirectoryService } from '../hive-runtime-cloud/hive-account-runtime-directory-service'
import type { HiveAccountRuntimeSessionService } from '../hive-runtime-cloud/hive-account-runtime-session-service'
import type { LocalRuntimeOwnershipService } from '../hive-runtime-cloud/local-runtime-ownership-service'

type DirectoryService = Pick<
  HiveAccountRuntimeDirectoryService,
  'getState' | 'refresh' | 'subscribe' | 'updateDisplayName'
>

type OwnershipService = Pick<
  LocalRuntimeOwnershipService,
  'getState' | 'refresh' | 'claimLocalRuntime' | 'subscribe'
>

type SessionService = Pick<HiveAccountRuntimeSessionService, 'list' | 'revoke'>

export type HiveRuntimeCloudHandlerServices = Readonly<{
  directory: DirectoryService
  ownership: OwnershipService
  sessions: SessionService
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function requireHiveLocalRuntimeClaimRequest(value: unknown): HiveLocalRuntimeClaimRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Runtime claim request')
  }
  const request = value as Record<string, unknown>
  if (
    Object.keys(request).length !== 1 ||
    !Object.hasOwn(request, 'expectedAccountId') ||
    typeof request.expectedAccountId !== 'string' ||
    !UUID_PATTERN.test(request.expectedAccountId)
  ) {
    throw new Error('Invalid Runtime claim request')
  }
  return { expectedAccountId: request.expectedAccountId }
}

export function requireHiveRuntimeSessionRevokeRequest(
  value: unknown
): HiveRuntimeSessionRevokeRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Runtime session revoke request')
  }
  const request = value as Record<string, unknown>
  if (
    Object.keys(request).length !== 2 ||
    !Object.hasOwn(request, 'managedSessionId') ||
    !Object.hasOwn(request, 'expectedResourceVersion') ||
    typeof request.managedSessionId !== 'string' ||
    !UUID_PATTERN.test(request.managedSessionId) ||
    typeof request.expectedResourceVersion !== 'number' ||
    !Number.isSafeInteger(request.expectedResourceVersion) ||
    request.expectedResourceVersion < 1
  ) {
    throw new Error('Invalid Runtime session revoke request')
  }
  return {
    managedSessionId: request.managedSessionId,
    expectedResourceVersion: request.expectedResourceVersion
  }
}

export function requireHiveRuntimeDisplayNameUpdateRequest(
  value: unknown
): HiveRuntimeDisplayNameUpdateRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Runtime display-name request')
  }
  const request = value as Record<string, unknown>
  if (
    Object.keys(request).length !== 3 ||
    !Object.hasOwn(request, 'runtimeRecordId') ||
    !Object.hasOwn(request, 'cloudDisplayName') ||
    !Object.hasOwn(request, 'expectedCloudDisplayNameVersion') ||
    typeof request.runtimeRecordId !== 'string' ||
    !UUID_PATTERN.test(request.runtimeRecordId) ||
    (request.cloudDisplayName !== null && typeof request.cloudDisplayName !== 'string') ||
    typeof request.expectedCloudDisplayNameVersion !== 'number' ||
    !Number.isSafeInteger(request.expectedCloudDisplayNameVersion) ||
    request.expectedCloudDisplayNameVersion < 1
  ) {
    throw new Error('Invalid Runtime display-name request')
  }
  let cloudDisplayName: string | null
  try {
    cloudDisplayName =
      request.cloudDisplayName === null
        ? null
        : normalizeHiveRuntimeDisplayName(request.cloudDisplayName)
  } catch {
    throw new Error('Invalid Runtime display-name request')
  }
  return {
    runtimeRecordId: request.runtimeRecordId,
    cloudDisplayName,
    expectedCloudDisplayNameVersion: request.expectedCloudDisplayNameVersion
  }
}

function broadcast(channel: string, state: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try {
        window.webContents.send(channel, state)
      } catch {
        // A window can be destroyed between the liveness check and send. UI
        // teardown must not turn a committed cloud state into an operation failure.
      }
    }
  }
}

export function registerHiveRuntimeCloudHandlers(services: HiveRuntimeCloudHandlerServices): void {
  ipcMain.handle('hiveRuntimeCloud:getDirectory', () => services.directory.getState())
  ipcMain.handle('hiveRuntimeCloud:refreshDirectory', () => services.directory.refresh())
  ipcMain.handle('hiveRuntimeCloud:updateDisplayName', (_event, value: unknown) =>
    services.directory.updateDisplayName(requireHiveRuntimeDisplayNameUpdateRequest(value))
  )
  ipcMain.handle('hiveRuntimeCloud:getLocalOwnership', () => services.ownership.getState())
  ipcMain.handle('hiveRuntimeCloud:refreshLocalOwnership', () => services.ownership.refresh(true))
  ipcMain.handle('hiveRuntimeCloud:claimLocalRuntime', (_event, value: unknown) => {
    const request = requireHiveLocalRuntimeClaimRequest(value)
    return services.ownership.claimLocalRuntime(request.expectedAccountId, async (userCode) => {
      if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode)) {
        throw new Error('Invalid Runtime claim code')
      }
      const url = new URL('/runtime-claim', hivecodeProductConfig.services.identity.userLoginUrl)
      url.hash = new URLSearchParams({ userCode }).toString()
      await shell.openExternal(url.toString())
    })
  })
  ipcMain.handle('hiveRuntimeCloud:listSessions', (_event, cursor: unknown = null) => {
    if (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(cursor))) {
      throw new Error('Invalid Runtime session cursor')
    }
    return services.sessions.list(cursor)
  })
  ipcMain.handle('hiveRuntimeCloud:revokeSession', (_event, value: unknown) => {
    const request = requireHiveRuntimeSessionRevokeRequest(value)
    return services.sessions.revoke(request.managedSessionId, request.expectedResourceVersion)
  })

  services.directory.subscribe((state: HiveAccountRuntimeDirectoryState) =>
    broadcast(HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL, state)
  )
  services.ownership.subscribe((state: HiveLocalRuntimeOwnershipState) =>
    broadcast(HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL, state)
  )
}

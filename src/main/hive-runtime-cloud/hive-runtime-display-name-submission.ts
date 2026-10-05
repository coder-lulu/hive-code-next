import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import type { DesktopPendingRuntimeDisplayName } from './hive-runtime-display-name-pending-store'
import {
  blockRuntimeDisplayNameTask,
  reconcileDesktopRuntimeDisplayNames
} from './hive-runtime-display-name-reconcile'

export type RuntimeDisplayNameClient = Pick<
  HiveRuntimeCloudAccountClient,
  'getOwnedRuntime' | 'updateOwnedRuntimeDisplayName'
>

type Submission = Readonly<{
  client: RuntimeDisplayNameClient
  authorization: HiveRuntimeCloudAuthorization
  now: () => number
  current: () => DesktopPendingRuntimeDisplayName | null
  replace: (task: DesktopPendingRuntimeDisplayName | null) => void
}>

export async function readRuntimeDisplayNameTask(args: Submission): Promise<void> {
  const initial = args.current()
  if (!initial) {
    return
  }
  try {
    const entry = await args.client.getOwnedRuntime(
      initial.runtimeRecordId,
      args.authorization.accessToken
    )
    const current = args.current()
    if (!current) {
      return
    }
    const task =
      current.status === 'SUBMITTING'
        ? { ...current, status: 'UNCONFIRMED' as const, errorCode: 'RESULT_UNKNOWN' as const }
        : current
    args.replace(
      reconcileDesktopRuntimeDisplayNames([task], args.authorization, [entry])[0] ?? null
    )
  } catch (failure) {
    const current = args.current()
    if (!current) {
      return
    }
    const status = failure instanceof HiveRuntimeCloudRequestError ? failure.status : null
    args.replace(
      blockRuntimeDisplayNameTask(
        current,
        status === 401
          ? 'AUTH_UNVERIFIED'
          : status === 403 || status === 404
            ? 'TARGET_UNAVAILABLE'
            : 'READ_UNAVAILABLE'
      )
    )
  }
}

export async function submitRuntimeDisplayNameTask(args: Submission): Promise<void> {
  const initial = args.current()
  if (!initial || (initial.retryNotBefore != null && initial.retryNotBefore > args.now())) {
    return
  }
  await readRuntimeDisplayNameTask(args)
  const task = args.current()
  if (!task || task.status !== 'QUEUED') {
    return
  }
  args.replace({ ...task, status: 'SUBMITTING', errorCode: null, retryNotBefore: null })
  try {
    const response = await args.client.updateOwnedRuntimeDisplayName(
      task.runtimeRecordId,
      task.desiredName,
      task.expectedCloudDisplayNameVersion,
      args.authorization.accessToken
    )
    const current = args.current()
    if (!current) {
      return
    }
    if (response.ownershipEpoch !== task.expectedOwnershipEpoch) {
      args.replace(blockRuntimeDisplayNameTask(current, 'OWNERSHIP_CHANGED'))
    } else if (
      current.status !== 'BLOCKED' &&
      (current.latestCloudDisplayNameVersion == null ||
        current.latestCloudDisplayNameVersion < response.cloudDisplayNameVersion ||
        current.latestCloudDisplayName === task.desiredName)
    ) {
      args.replace({
        ...current,
        status: 'CONFIRMED',
        errorCode: null,
        resumeStatus: null,
        confirmedCloudDisplayNameVersion: response.cloudDisplayNameVersion
      })
    }
  } catch (failure) {
    const current = args.current()
    if (!current || current.status === 'CONFIRMED' || current.errorCode === 'OWNERSHIP_CHANGED') {
      return
    }
    const status = failure instanceof HiveRuntimeCloudRequestError ? failure.status : null
    if (failure instanceof HiveRuntimeCloudRequestError && status === 429) {
      args.replace({
        ...current,
        status: 'QUEUED',
        errorCode: 'RATE_LIMITED',
        retryNotBefore: args.now() + Math.max(30_000, failure.retryAfterMs ?? 30_000)
      })
      return
    }
    if (status === 400 || status === 422) {
      args.replace(blockRuntimeDisplayNameTask(current, 'REQUEST_REJECTED'))
      return
    }
    args.replace({
      ...current,
      status: status === 409 ? 'CONFLICT' : 'UNCONFIRMED',
      errorCode: status === 409 ? 'VERSION_CONFLICT' : 'RESULT_UNKNOWN',
      resumeStatus: null
    })
    await readRuntimeDisplayNameTask(args)
  }
}

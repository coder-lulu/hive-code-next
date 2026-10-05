import { useEffect, useRef, useState } from 'react'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { normalizeHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export function useRuntimeCloudDisplayNameDraft(environment: PublicKnownRuntimeEnvironment | null) {
  const update = useAppStore((state) => state.updateAccountRuntimeDisplayName)
  const discard = useAppStore((state) => state.discardAccountRuntimeDisplayName)
  const refresh = useAppStore((state) => state.refreshAccountRuntimeCloud)
  const task = useAppStore((state) =>
    state.accountRuntimeDirectory.pendingDisplayNames?.find(
      (pending) => pending.runtimeRecordId === environment?.accountClaim?.runtimeRecordId
    )
  )
  const [name, setName] = useState(() =>
    task
      ? (task.desiredName ?? '')
      : (environment?.accountClaim?.cloudDisplayName ?? environment?.name ?? '')
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const targetRef = useRef(environment?.accountClaim?.runtimeRecordId ?? null)
  const fenceRef = useRef<{ epoch: number | null; version: number } | null>(
    task && task.status !== 'CONFIRMED'
      ? {
          epoch: task.expectedOwnershipEpoch,
          version: task.expectedCloudDisplayNameVersion
        }
      : environment?.accountClaim
        ? {
            epoch: environment.accountClaim.ownershipEpoch,
            version: environment.accountClaim.cloudDisplayNameVersion
          }
        : null
  )

  useEffect(
    () => () => {
      targetRef.current = null
    },
    []
  )

  const claim = environment?.accountClaim
  const changedFence =
    claim &&
    fenceRef.current &&
    (claim.ownershipEpoch !== fenceRef.current.epoch ||
      claim.cloudDisplayNameVersion !== fenceRef.current.version)
  const needsConfirmation = Boolean(
    changedFence || (task && task.status !== 'QUEUED' && task.status !== 'CONFIRMED')
  )
  const busy = saving || task?.status === 'SUBMITTING'
  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (busy) {
      return false
    }
    const target = targetRef.current
    setSaving(true)
    setError(null)
    try {
      await operation()
      return target === targetRef.current
    } catch {
      if (target === targetRef.current) {
        setError(
          translate(
            'runtimeCloudAlias.saveFailed',
            'Could not save the Runtime name. Refresh the cloud list and review your draft.'
          )
        )
      }
      return false
    } finally {
      if (target === targetRef.current) {
        setSaving(false)
      }
    }
  }
  const submit = async (value: string | null, confirmed = false): Promise<void> => {
    if (!claim || busy || (needsConfirmation && !confirmed)) {
      return
    }
    let normalized: string | null
    try {
      normalized =
        value === null || value.trim() === '' ? null : normalizeHiveRuntimeDisplayName(value)
    } catch {
      setError(
        translate(
          'auto.components.settings.RuntimeCloudDisplayNameDialog.invalidName',
          'Enter 1–128 characters without control or bidirectional formatting characters.'
        )
      )
      return
    }
    const fence = confirmed
      ? { epoch: claim.ownershipEpoch, version: claim.cloudDisplayNameVersion }
      : fenceRef.current
    if (!fence || fence.epoch === null) {
      return
    }
    const expectedOwnershipEpoch = fence.epoch
    const accepted = await run(() =>
      update({
        runtimeRecordId: claim.runtimeRecordId,
        cloudDisplayName: normalized,
        expectedOwnershipEpoch,
        expectedCloudDisplayNameVersion: fence.version,
        ...(task ? { pendingRevision: task.revision } : {})
      })
    )
    if (accepted) {
      fenceRef.current = fence
      setQueued(true)
    }
  }
  const adoptCloudName = async (): Promise<boolean> => {
    if (!claim) {
      return false
    }
    const accepted = await run(async () => {
      if (task) {
        await discard({ runtimeRecordId: claim.runtimeRecordId, revision: task.revision })
      }
    })
    if (accepted) {
      fenceRef.current = { epoch: claim.ownershipEpoch, version: claim.cloudDisplayNameVersion }
      setName(claim.cloudDisplayName ?? '')
      setQueued(false)
    }
    return accepted
  }
  return {
    name,
    setName,
    busy,
    error,
    clearError: () => setError(null),
    queued,
    task,
    needsConfirmation,
    submit,
    adoptCloudName,
    checkAgain: () => run(refresh)
  }
}

import type { HiveRuntimePendingDisplayName } from '../../../../shared/hive-runtime-cloud'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

export function getRuntimeDisplayNameTaskLabel(task: HiveRuntimePendingDisplayName): string {
  switch (task.status) {
    case 'QUEUED':
      return task.errorCode === 'RATE_LIMITED'
        ? translate('runtimeCloudAlias.rateLimited', 'Name change queued; wait before retrying.')
        : translate('runtimeCloudAlias.queued', 'Name change queued')
    case 'SUBMITTING':
      return translate('runtimeCloudAlias.submitting', 'Updating cloud name')
    case 'UNCONFIRMED':
      return translate('runtimeCloudAlias.unconfirmed', 'Name change result is not confirmed')
    case 'CONFLICT':
      return translate('runtimeCloudAlias.conflict', 'The cloud name changed; your draft is kept.')
    case 'CONFIRMED':
      return translate('runtimeCloudAlias.confirmed', 'Cloud name confirmed')
    case 'BLOCKED':
      return task.errorCode === 'OWNERSHIP_CHANGED' || task.errorCode === 'OWNERSHIP_UNVERIFIED'
        ? translate(
            'runtimeCloudAlias.ownershipBlocked',
            'Original ownership cannot be confirmed; your draft is kept.'
          )
        : translate(
            'runtimeCloudAlias.blocked',
            'Cloud name cannot be verified; your draft is kept.'
          )
  }
}

export function RuntimeCloudDisplayNameStatus({
  runtimeRecordId
}: {
  runtimeRecordId: string
}): React.JSX.Element | null {
  const task = useAppStore((state) =>
    state.accountRuntimeDirectory.pendingDisplayNames?.find(
      (pending) => pending.runtimeRecordId === runtimeRecordId
    )
  )
  if (!task || task.status === 'CONFIRMED') {
    return null
  }
  return (
    <p className="mt-1 break-words text-xs text-muted-foreground" role="status">
      {getRuntimeDisplayNameTaskLabel(task)}{' '}
      {translate('runtimeCloudAlias.draft', 'Draft: {{name}}', {
        name: task.desiredName ?? translate('runtimeCloudAlias.clearedName', 'Use device name')
      })}
    </p>
  )
}

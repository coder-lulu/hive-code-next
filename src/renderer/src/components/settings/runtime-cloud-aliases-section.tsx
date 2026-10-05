import { Monitor, Pencil } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { getHostSettingOverride } from '../../../../shared/host-setting-overrides'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  RuntimeCloudDisplayNameStatus,
  getRuntimeDisplayNameTaskLabel
} from './runtime-cloud-display-name-status'

export function RuntimeCloudAliasesSection({
  settings,
  localEnvironment,
  environments,
  onRename
}: {
  settings: GlobalSettings
  localEnvironment: PublicKnownRuntimeEnvironment | null
  environments: PublicKnownRuntimeEnvironment[]
  onRename: (environment: PublicKnownRuntimeEnvironment) => void
}): React.JSX.Element {
  const directory = useAppStore((state) => state.accountRuntimeDirectory)
  const discard = useAppStore((state) => state.discardAccountRuntimeDisplayName)
  const knownIds = new Set(
    [...environments, ...(localEnvironment ? [localEnvironment] : [])].map(
      (environment) => environment.accountClaim?.runtimeRecordId
    )
  )
  const orphaned =
    directory.pendingDisplayNames?.filter((task) => !knownIds.has(task.runtimeRecordId)) ?? []
  const localNote = getHostSettingOverride(settings, 'local', 'displayLabel')
  return (
    <div className="space-y-3">
      {directory.displayNameSyncError ? (
        <p role="alert" className="text-sm text-destructive">
          {translate(
            'runtimeCloudAlias.storageUnavailable',
            'Name changes are unavailable because the local draft store could not be read or saved. Existing drafts are retained.'
          )}
        </p>
      ) : null}
      {localEnvironment?.accountClaim ? (
        <div
          data-settings-section="current-computer"
          className="flex items-center gap-3 rounded-md border border-border px-4 py-3"
        >
          <Monitor className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={localEnvironment.name}>
              {localEnvironment.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate('runtimeCloudAlias.currentComputer', 'Current computer · local execution')}
            </p>
            {localNote ? (
              <p className="break-words text-xs text-muted-foreground">
                {translate('runtimeCloudAlias.localNote', 'Local note: {{name}}', {
                  name: localNote
                })}
              </p>
            ) : null}
            <RuntimeCloudDisplayNameStatus
              runtimeRecordId={localEnvironment.accountClaim.runtimeRecordId}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRename(localEnvironment)}
            disabled={Boolean(directory.displayNameSyncError)}
            aria-label={translate(
              'runtimeCloudAlias.renameCurrentComputer',
              'Rename current computer in HiveCloud'
            )}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ) : null}
      {orphaned.map((task) => (
        <div key={task.runtimeRecordId} className="space-y-2 rounded-md border border-border p-3">
          <p className="break-words text-sm">
            {translate(
              'runtimeCloudAlias.orphanedDraft',
              'Retained draft for Runtime {{id}}: {{name}}',
              {
                id: task.runtimeRecordId.slice(0, 8),
                name:
                  task.desiredName ?? translate('runtimeCloudAlias.clearedName', 'Use device name')
              }
            )}
          </p>
          <p role="status" className="text-xs text-muted-foreground">
            {getRuntimeDisplayNameTaskLabel(task)}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={task.status === 'SUBMITTING' || Boolean(directory.displayNameSyncError)}
            onClick={() =>
              void discard({
                runtimeRecordId: task.runtimeRecordId,
                revision: task.revision
              }).catch(() => undefined)
            }
          >
            {translate('runtimeCloudAlias.discardDraft', 'Discard retained draft')}
          </Button>
        </div>
      ))}
    </div>
  )
}

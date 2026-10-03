import { useMemo, useState, type ReactNode } from 'react'
import { Accessibility, Camera, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import type {
  ComputerUsePermissionId,
  ComputerUsePermissionState,
  ComputerUsePermissionStatus
} from '../../../../shared/computer-use-permissions-types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { translate } from '@/i18n/i18n'

type PermissionDefinition = {
  id: ComputerUsePermissionId
  labelKey: string
  labelDefault: string
  descriptionKey: string
  descriptionDefault: string
  icon: ReactNode
}

const PERMISSIONS: PermissionDefinition[] = [
  {
    id: 'accessibility',
    labelKey: 'auto.components.settings.ComputerUsePane.6b5a2cd3a5',
    labelDefault: 'Accessibility',
    descriptionKey: 'auto.components.settings.ComputerUsePane.4d03dec2d0',
    descriptionDefault: 'Read app interface trees and perform requested actions.',
    icon: <Accessibility className="size-4" />
  },
  {
    id: 'screenshots',
    labelKey: 'auto.components.settings.ComputerUsePane.screenRecordingLabel',
    labelDefault: 'Screen Recording (for screenshots)',
    descriptionKey: 'auto.components.settings.ComputerUsePane.screenRecordingDescription',
    descriptionDefault: 'Allow window screenshots through macOS Screen Recording permission.',
    icon: <Camera className="size-4" />
  }
]

function statusLabel(status: ComputerUsePermissionStatus | undefined): string {
  switch (status) {
    case 'granted':
      return translate('auto.components.settings.ComputerUsePane.statusGranted', 'Granted')
    case 'unsupported':
      return translate('auto.components.settings.ComputerUsePane.statusUnsupported', 'macOS only')
    case 'not-granted':
    case undefined:
      return translate('auto.components.settings.ComputerUsePane.statusNotEnabled', 'Not enabled')
  }
}

function statusClass(status: ComputerUsePermissionStatus | undefined): string {
  return status === 'granted'
    ? 'border-status-success-border bg-status-success-background text-status-success'
    : 'border-border bg-muted text-muted-foreground'
}

export type ComputerUsePermissionsViewProps = {
  platform: NodeJS.Platform | null
  states: ComputerUsePermissionState[]
  loading: boolean
  readError: string | null
  helperUnavailableReason: string | null
  pendingId: ComputerUsePermissionId | null
  resetting: boolean
  onRefresh: () => void
  onOpenPermission: (id: ComputerUsePermissionId) => void
  onResetAccess: () => void
}

export function ComputerUsePermissionsView({
  platform,
  states,
  loading,
  readError,
  helperUnavailableReason,
  pendingId,
  resetting,
  onRefresh,
  onOpenPermission,
  onResetAccess
}: ComputerUsePermissionsViewProps): React.JSX.Element | null {
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false)
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state.status] as const)),
    [states]
  )
  const grantedCount = PERMISSIONS.filter(
    (permission) => stateById.get(permission.id) === 'granted'
  ).length
  const allGranted = grantedCount === PERMISSIONS.length
  const showDetails = !allGranted || detailsExpanded
  const setupUnavailable = helperUnavailableReason !== null
  const resetAccessDisabled =
    resetting ||
    loading ||
    readError !== null ||
    states.length === 0 ||
    pendingId !== null ||
    setupUnavailable
  const summaryTitle = readError
    ? translate(
        'auto.components.settings.ComputerUsePane.readFailed',
        'Could not check system permissions'
      )
    : setupUnavailable
      ? translate(
          'auto.components.settings.computerUseSummary.unavailableTitle',
          'Computer Use is unavailable.'
        )
      : allGranted
        ? translate(
            'auto.components.settings.computerUseSummary.readyTitle',
            'Computer Use is ready.'
          )
        : translate(
            'auto.components.settings.computerUseSummary.permissionsTitle',
            'Finish setup to use local apps.'
          )
  const missingCount = PERMISSIONS.length - grantedCount
  const summaryDescription = readError
    ? translate(
        'auto.components.settings.ComputerUsePane.retryAfterFailure',
        'Retry the local permission check to see the current status.'
      )
    : setupUnavailable
      ? translate(
          'auto.components.settings.computerUseSummary.unavailableDescription',
          'Computer Use permissions are unavailable because {{value0}}.',
          { value0: helperUnavailableReason }
        )
      : allGranted
        ? translate(
            'auto.components.settings.computerUseSummary.readyDescription',
            'Agents can inspect and operate app windows when you ask.'
          )
        : missingCount === 1
          ? translate(
              'auto.components.settings.computerUseSummary.permissionsRequired_one',
              '1 permission required before agents can operate app windows.'
            )
          : translate(
              'auto.components.settings.computerUseSummary.permissionsRequired_other',
              '{{value0}} permissions required before agents can operate app windows.',
              { value0: missingCount }
            )

  if (platform !== 'darwin') {
    if (platform !== null && readError === null) {
      return null
    }
    return (
      <section
        aria-label={translate(
          'auto.components.settings.ComputerUsePane.systemPermissions',
          'System permissions'
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {readError
                ? translate(
                    'auto.components.settings.ComputerUsePane.readFailed',
                    'Could not check system permissions'
                  )
                : translate(
                    'auto.components.settings.ComputerUsePane.checkingPlatform',
                    'Checking local system permissions'
                  )}
            </p>
            {readError ? (
              <p role="alert" className="text-xs text-destructive">
                {readError}
              </p>
            ) : null}
          </div>
          {readError ? (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              {translate('auto.components.settings.ComputerUsePane.retry', 'Retry')}
            </Button>
          ) : (
            <RefreshCw aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      aria-label={translate(
        'auto.components.settings.ComputerUsePane.systemPermissions',
        'System permissions'
      )}
      className="space-y-3"
    >
      {readError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-xs text-destructive">{readError}</p>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading || resetting}>
            {translate('auto.components.settings.ComputerUsePane.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/25 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" />
            {summaryTitle}
            {allGranted && !readError && !setupUnavailable ? (
              <Badge variant="outline" className="border-status-success-border text-status-success">
                {translate('auto.components.settings.ComputerUsePane.0c29da5805', 'Ready')}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{summaryDescription}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {allGranted ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showDetails}
              onClick={() => setDetailsExpanded((expanded) => !expanded)}
            >
              {showDetails
                ? translate('auto.components.settings.ComputerUsePane.hideDetails', 'Hide details')
                : translate('auto.components.settings.ComputerUsePane.showDetails', 'View details')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={resetting || loading}
            onClick={onRefresh}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            {translate('auto.components.settings.ComputerUsePane.d95d1cfab8', 'Refresh')}
          </Button>
        </div>
      </div>

      {showDetails ? (
        <div className="divide-y divide-border/60 rounded-lg border border-border/60">
          {PERMISSIONS.map((permission) => {
            const status = stateById.get(permission.id)
            return (
              <div
                key={permission.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 text-muted-foreground">{permission.icon}</div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {translate(permission.labelKey, permission.labelDefault)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusClass(status)}`}
                      >
                        {statusLabel(status)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {translate(permission.descriptionKey, permission.descriptionDefault)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={
                    resetting ||
                    loading ||
                    readError !== null ||
                    pendingId !== null ||
                    status === 'unsupported' ||
                    setupUnavailable
                  }
                  onClick={() => onOpenPermission(permission.id)}
                >
                  <ExternalLink className="size-3.5" />
                  {translate('auto.components.settings.ComputerUsePane.45f8e22c2e', 'Open')}
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}
      <button
        type="button"
        disabled={resetAccessDisabled}
        onClick={() => setResetConfirmationOpen(true)}
        className="ml-auto block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {resetting
          ? translate('auto.components.settings.ComputerUsePane.506f2acf7a', 'Resetting access...')
          : translate('auto.components.settings.ComputerUsePane.6b17602073', 'Reset access')}
      </button>
      <Dialog open={resetConfirmationOpen} onOpenChange={setResetConfirmationOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.ComputerUsePane.resetConfirmTitle',
                'Reset Computer Use access?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.ComputerUsePane.resetConfirmDescription',
                'This resets the local macOS permissions. You will need to grant access again in System Settings.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResetConfirmationOpen(false)}>
              {translate('auto.components.settings.ComputerUsePane.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={resetAccessDisabled}
              onClick={() => {
                setResetConfirmationOpen(false)
                onResetAccess()
              }}
            >
              {translate('auto.components.settings.ComputerUsePane.6b17602073', 'Reset access')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

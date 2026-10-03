import { Loader2, Trash2 } from 'lucide-react'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  getRuntimeEnvironmentEndpointDisplay,
  getRuntimeEnvironmentRemovalPresentation
} from './runtime-environment-host-details'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

export function RuntimeEnvironmentSwitchDialog({
  pendingSwitchValue,
  switchingValue,
  switchError,
  getEnvironmentLabel,
  onOpenChange,
  onCancel,
  onConfirm
}: {
  pendingSwitchValue: string | null
  switchingValue: string | null
  switchError: string | null
  getEnvironmentLabel: (value: string) => string
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog open={pendingSwitchValue !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.d570c35a99',
              'Switch Server'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.b2290ed203',
              'Orca will focus this host and load its projects. Existing terminals and browser tabs on other hosts stay alive.'
            )}
          </DialogDescription>
        </DialogHeader>
        {pendingSwitchValue ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.05e0fc3ebf',
                'Switch to'
              )}
            </div>
            <div className="mt-0.5 truncate font-medium">
              {getEnvironmentLabel(pendingSwitchValue)}
            </div>
          </div>
        ) : null}
        {switchError ? <p className="text-sm text-destructive">{switchError}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={switchingValue !== null}>
            {translate('auto.components.settings.RuntimeEnvironmentsPane.af53761f31', 'Cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={switchingValue !== null}>
            {switchingValue !== null ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.settings.RuntimeEnvironmentsPane.d2e00809e4', 'Switch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RuntimeEnvironmentRemoveDialog({
  pendingRemove,
  removingId,
  removeError,
  removingActiveServer,
  onOpenChange,
  onCancel,
  onConfirm
}: {
  pendingRemove: PublicKnownRuntimeEnvironment | null
  removingId: string | null
  removeError: string | null
  removingActiveServer: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const removalPresentation = pendingRemove
    ? getRuntimeEnvironmentRemovalPresentation(pendingRemove, removingActiveServer)
    : null
  return (
    <Dialog open={pendingRemove !== null && removalPresentation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">{removalPresentation?.title}</DialogTitle>
          <DialogDescription>{removalPresentation?.description}</DialogDescription>
        </DialogHeader>
        {pendingRemove ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="truncate font-medium">{pendingRemove.name}</div>
            <div className="mt-0.5 truncate font-mono text-muted-foreground">
              {getRuntimeEnvironmentEndpointDisplay(pendingRemove)}
            </div>
          </div>
        ) : null}
        {removeError ? <p className="text-sm text-destructive">{removeError}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={removingId !== null}>
            {translate('auto.components.settings.RuntimeEnvironmentsPane.af53761f31', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={removingId !== null}>
            {removingId !== null ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {removalPresentation?.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

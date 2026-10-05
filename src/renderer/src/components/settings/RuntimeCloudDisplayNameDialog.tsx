import { useRef } from 'react'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { getRuntimeDisplayNameTaskLabel } from './runtime-cloud-display-name-status'
import { useRuntimeCloudDisplayNameDraft } from './use-runtime-cloud-display-name-draft'

type RuntimeCloudDisplayNameDialogProps = Readonly<{
  environment: PublicKnownRuntimeEnvironment | null
  onClose: () => void
}>

export function RuntimeCloudDisplayNameDialog(
  props: RuntimeCloudDisplayNameDialogProps
): React.JSX.Element {
  return (
    <RuntimeCloudDisplayNameDialogContent
      key={props.environment?.accountClaim?.runtimeRecordId ?? 'closed'}
      {...props}
    />
  )
}

function RuntimeCloudDisplayNameDialogContent({
  environment,
  onClose
}: RuntimeCloudDisplayNameDialogProps): React.JSX.Element {
  const openerRef = useRef<HTMLElement | null>(null)
  const draft = useRuntimeCloudDisplayNameDraft(environment)
  const cloudName =
    environment?.accountClaim?.cloudDisplayName ??
    environment?.accountClaim?.reportedDeviceName ??
    translate('runtimeCloudAlias.clearedName', 'Use device name')
  return (
    <Dialog
      open={environment !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent
        className="max-w-sm sm:max-w-sm"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          const opener = document.activeElement
          openerRef.current =
            opener instanceof HTMLElement && opener !== document.body && opener.isConnected
              ? opener
              : null
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current
          openerRef.current = null
          if (opener?.isConnected) {
            event.preventDefault()
            opener.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.title',
              'Rename Runtime'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.description',
              'This name follows your HiveCloud account. Local pairing and connection addresses are unchanged.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="break-words text-sm text-muted-foreground">
            {translate('runtimeCloudAlias.cloudName', 'Cloud name: {{name}}', { name: cloudName })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="runtime-cloud-display-name">
              {translate(
                'auto.components.settings.RuntimeCloudDisplayNameDialog.label',
                'Runtime name'
              )}
            </Label>
            <Input
              id="runtime-cloud-display-name"
              value={draft.name}
              disabled={draft.busy}
              aria-invalid={Boolean(draft.error)}
              aria-describedby={draft.error ? 'runtime-cloud-display-name-error' : undefined}
              onChange={(event) => {
                draft.setName(event.target.value)
                draft.clearError()
              }}
            />
            {draft.error ? (
              <p
                id="runtime-cloud-display-name-error"
                role="alert"
                aria-live="assertive"
                className="text-sm text-destructive"
              >
                {draft.error}
              </p>
            ) : null}
          </div>
          {draft.task ? (
            <p className="break-words text-sm text-muted-foreground" role="status">
              {getRuntimeDisplayNameTaskLabel(draft.task)}
            </p>
          ) : draft.queued ? (
            <p role="status" className="text-sm text-muted-foreground">
              {translate('runtimeCloudAlias.queued', 'Name change queued')}
            </p>
          ) : null}
          {draft.needsConfirmation ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="break-words text-sm">
                {translate(
                  'runtimeCloudAlias.reviewDraft',
                  'Review the current cloud name before submitting your draft as a new change.'
                )}
              </p>
              {draft.task?.latestCloudDisplayNameVersion ? (
                <p className="break-words text-xs text-muted-foreground">
                  {translate(
                    'runtimeCloudAlias.latestCloudName',
                    'Last verified cloud name: {{name}}',
                    {
                      name:
                        draft.task.latestCloudDisplayName ??
                        translate('runtimeCloudAlias.clearedName', 'Use device name')
                    }
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={draft.busy}
                  onClick={() => void draft.checkAgain()}
                >
                  {translate('runtimeCloudAlias.checkAgain', 'Check cloud again')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={draft.busy}
                  onClick={() => void draft.adoptCloudName()}
                >
                  {translate('runtimeCloudAlias.adoptCloud', 'Discard draft and use cloud name')}
                </Button>
                <Button
                  size="sm"
                  disabled={draft.busy}
                  onClick={() => void draft.submit(draft.name, true)}
                >
                  {translate('runtimeCloudAlias.confirmDraft', 'Confirm submitting my draft')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void draft.submit(null)}
            disabled={draft.busy || draft.needsConfirmation}
          >
            {translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.clear',
              'Clear cloud name'
            )}
          </Button>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {translate('runtimeCloudAlias.close', 'Close')}
            </Button>
            {!draft.needsConfirmation ? (
              <Button onClick={() => void draft.submit(draft.name)} disabled={draft.busy}>
                {translate('auto.components.settings.RuntimeCloudDisplayNameDialog.save', 'Save')}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

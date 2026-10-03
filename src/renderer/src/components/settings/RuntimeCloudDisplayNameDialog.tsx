import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { normalizeHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
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

type RuntimeCloudDisplayNameDialogProps = Readonly<{
  environment: PublicKnownRuntimeEnvironment | null
  onClose: () => void
}>

export function RuntimeCloudDisplayNameDialog({
  environment,
  onClose
}: RuntimeCloudDisplayNameDialogProps): React.JSX.Element {
  const updateDisplayName = useAppStore((state) => state.updateAccountRuntimeDisplayName)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initializedRuntimeRecordIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!environment?.accountClaim) {
      initializedRuntimeRecordIdRef.current = null
      return
    }
    const runtimeRecordId = environment.accountClaim.runtimeRecordId
    if (initializedRuntimeRecordIdRef.current !== runtimeRecordId) {
      initializedRuntimeRecordIdRef.current = runtimeRecordId
      setName(environment.name)
      setError(null)
    }
  }, [environment])

  const submit = async (desiredName: string | null): Promise<void> => {
    const claim = environment?.accountClaim
    if (!claim || claim.cloudDisplayNameVersion == null || saving) {
      return
    }
    let cloudDisplayName: string | null = null
    try {
      cloudDisplayName = desiredName === null ? null : normalizeHiveRuntimeDisplayName(desiredName)
    } catch {
      setError(
        translate(
          'auto.components.settings.RuntimeCloudDisplayNameDialog.invalidName',
          'Enter 1–128 characters without control or bidirectional formatting characters.'
        )
      )
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateDisplayName({
        runtimeRecordId: claim.runtimeRecordId,
        cloudDisplayName,
        expectedCloudDisplayNameVersion: claim.cloudDisplayNameVersion
      })
      toast.success(
        cloudDisplayName === null
          ? translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.clearSuccess',
              'Cloud Runtime name clear queued. It will sync with HiveCloud when available.'
            )
          : translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.renameSuccess',
              'Runtime name change queued. It will sync with HiveCloud when available.'
            )
      )
      onClose()
    } catch {
      setError(
        translate(
          'auto.components.settings.RuntimeCloudDisplayNameDialog.saveFailed',
          'Could not save the Runtime name. Refresh the Runtime list and try again.'
        )
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={environment !== null}
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
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
        <div className="space-y-2">
          <Label htmlFor="runtime-cloud-display-name">
            {translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.label',
              'Runtime name'
            )}
          </Label>
          <Input
            id="runtime-cloud-display-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            disabled={saving}
            autoFocus
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert" aria-live="assertive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => void submit(null)} disabled={saving}>
            {translate(
              'auto.components.settings.RuntimeCloudDisplayNameDialog.clear',
              'Clear cloud name'
            )}
          </Button>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {translate('auto.components.settings.RuntimeCloudDisplayNameDialog.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void submit(name)} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {translate('auto.components.settings.RuntimeCloudDisplayNameDialog.save', 'Save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

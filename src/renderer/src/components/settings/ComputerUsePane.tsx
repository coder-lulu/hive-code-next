import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ComputerUsePermissionId,
  ComputerUsePermissionState
} from '../../../../shared/computer-use-permissions-types'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { ComputerUsePermissionsView } from './ComputerUsePermissionsView'
import { ComputerUseSkillSetupPanel } from './ComputerUseSkillSetupPanel'
export { getComputerUsePaneSearchEntries } from './computer-use-search'

export function ComputerUsePermissionsSection(): React.JSX.Element {
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const [states, setStates] = useState<ComputerUsePermissionState[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<ComputerUsePermissionId | null>(null)
  const [resetting, setResetting] = useState(false)
  const [helperUnavailableReason, setHelperUnavailableReason] = useState<string | null>(null)
  // Why: reset changes OS permission state, so older status probes must not overwrite it.
  const resettingRef = useRef(false)
  const openingPermissionRef = useRef(false)
  const permissionOperationSequence = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      permissionOperationSequence.current += 1
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (resettingRef.current) {
      return
    }

    const operationId = ++permissionOperationSequence.current
    setLoading(true)
    try {
      const result = await window.api.computerUsePermissions.getStatus()
      if (operationId !== permissionOperationSequence.current || !mountedRef.current) {
        return
      }
      setPlatform(result.platform)
      setStates(result.permissions)
      setHelperUnavailableReason(result.helperUnavailableReason)
      setReadError(null)
    } catch (error) {
      if (operationId !== permissionOperationSequence.current || !mountedRef.current) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.settings.ComputerUsePane.2168fa5ab0',
              'Could not load Computer Use permissions'
            )
      setReadError(message)
      toast.error(message)
    } finally {
      if (operationId === permissionOperationSequence.current && mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Why: users grant these in System Settings, so refresh when focus returns
  // instead of polling while the settings pane is open.
  useEffect(() => {
    const onFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const openPermission = async (id: ComputerUsePermissionId): Promise<void> => {
    if (openingPermissionRef.current || resettingRef.current) {
      return
    }
    openingPermissionRef.current = true
    useAppStore.getState().recordFeatureInteraction('computer-use-setup')
    setPendingId(id)
    try {
      const result = await window.api.computerUsePermissions.openSetup({ id })
      if (!mountedRef.current) {
        return
      }
      if (result.launchedHelper) {
        toast.message(
          translate(
            'auto.components.settings.ComputerUsePane.697005758f',
            'Opened macOS Privacy & Security'
          )
        )
      } else {
        toast.message(
          result.platform === 'darwin'
            ? translate(
                'auto.components.settings.ComputerUsePane.740766c291',
                'Computer Use setup is already complete'
              )
            : translate(
                'auto.components.settings.ComputerUsePane.7801ac08ec',
                'Computer Use permissions are only required on macOS'
              )
        )
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.settings.ComputerUsePane.5c45349665',
                'Could not open Computer Use permissions'
              )
        )
      }
    } finally {
      openingPermissionRef.current = false
      if (mountedRef.current) {
        setPendingId(null)
      }
    }
  }

  const resetAccess = async (): Promise<void> => {
    if (resettingRef.current || openingPermissionRef.current) {
      return
    }

    resettingRef.current = true
    const operationId = ++permissionOperationSequence.current
    setResetting(true)
    try {
      const result = await window.api.computerUsePermissions.reset()
      if (operationId !== permissionOperationSequence.current || !mountedRef.current) {
        return
      }
      setPlatform(result.platform)
      setStates(result.permissions)
      setHelperUnavailableReason(result.helperUnavailableReason)
      setReadError(null)
      toast.message(
        translate(
          'auto.components.settings.ComputerUsePane.f189f448a3',
          'Reset Computer Use access'
        )
      )
    } catch (error) {
      if (operationId !== permissionOperationSequence.current || !mountedRef.current) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.settings.ComputerUsePane.3383ea1aab',
              'Could not reset Computer Use permissions'
            )
      setReadError(message)
      toast.error(message)
    } finally {
      if (operationId === permissionOperationSequence.current && mountedRef.current) {
        resettingRef.current = false
        setResetting(false)
        setLoading(false)
      }
    }
  }

  return (
    <ComputerUsePermissionsView
      platform={platform}
      states={states}
      loading={loading}
      readError={readError}
      helperUnavailableReason={helperUnavailableReason}
      pendingId={pendingId}
      resetting={resetting}
      onRefresh={() => void refresh()}
      onOpenPermission={(id) => void openPermission(id)}
      onResetAccess={() => void resetAccess()}
    />
  )
}

export function ComputerUsePane(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <ComputerUsePermissionsSection />
      <ComputerUseSkillSetupPanel />
    </div>
  )
}

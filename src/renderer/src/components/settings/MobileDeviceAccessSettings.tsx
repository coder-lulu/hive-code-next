import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getPairedMobileDevicesSnapshot,
  replacePairedMobileDevices,
  usePairedMobileDevices
} from '../mobile/paired-mobile-devices'
import { MobilePairedDevicesSection } from './MobilePairedDevicesSection'
import { translate } from '@/i18n/i18n'

export function MobileDeviceAccessSettings({ active }: { active: boolean }): React.JSX.Element {
  const { devices, loaded, loading, error, refresh } = usePairedMobileDevices({
    refreshOnMount: false
  })
  const mountedRef = useMountedRef()
  const pending = useRef(new Set<string>())
  const [revokingIds, setRevokingIds] = useState<ReadonlySet<string>>(new Set())
  const loadDevices = useCallback(async (): Promise<void> => {
    try {
      await refresh({ force: true })
    } catch {
      // The shared cache exposes the load error and retry action.
    }
  }, [refresh])
  useEffect(() => {
    if (active) {
      void loadDevices()
    }
  }, [active, loadDevices])
  const revokeDevice = async (deviceId: string): Promise<void> => {
    if (pending.current.has(deviceId)) {
      return
    }
    pending.current.add(deviceId)
    setRevokingIds(new Set(pending.current))
    try {
      const { revoked } = await window.api.mobile.revokeDevice({ deviceId })
      if (!revoked) {
        throw new Error('mobile.revokeDevice returned revoked=false')
      }
      try {
        await refresh({ force: true })
      } catch (error) {
        console.error('mobile.listDevices failed after revoke', error)
        replacePairedMobileDevices(
          getPairedMobileDevicesSnapshot().filter((device) => device.deviceId !== deviceId)
        )
      }
      if (mountedRef.current) {
        toast.success(translate('auto.components.settings.MobilePane.2e3dd0bc29', 'Device revoked'))
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.MobilePane.870e1b5ca5', 'Failed to revoke device')
        )
      }
    } finally {
      pending.current.delete(deviceId)
      if (mountedRef.current) {
        setRevokingIds(new Set(pending.current))
      }
    }
  }
  return (
    <MobilePairedDevicesSection
      devices={devices}
      hasQrCode={false}
      revokingDeviceIds={revokingIds}
      loading={loading || (!loaded && !error)}
      error={error}
      onRefreshDevices={() => void loadDevices()}
      onRevokeDevice={(id) => void revokeDevice(id)}
    />
  )
}

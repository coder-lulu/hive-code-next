import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { PairedMobileDevice } from '../mobile/paired-mobile-devices'

export type PairedDevice = PairedMobileDevice

type MobilePairedDevicesSectionProps = {
  devices: readonly PairedDevice[]
  hasQrCode: boolean
  onRevokeDevice: (deviceId: string) => void
  revokingDeviceIds?: ReadonlySet<string>
  loading?: boolean
  error?: boolean
  onRefreshDevices?: () => void
}

export function MobilePairedDevicesSection({
  devices,
  hasQrCode,
  onRevokeDevice,
  revokingDeviceIds,
  loading = false,
  error = false,
  onRefreshDevices
}: MobilePairedDevicesSectionProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <h3 className="mb-2 text-sm font-medium">
        {translate('phoneConnection.pairedDevices', 'QR-authorized devices')}
      </h3>
      {error ? (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <p>
            {translate('phoneConnection.devicesFailed', 'Authorized devices could not be loaded.')}
          </p>
          <Button variant="outline" size="sm" onClick={onRefreshDevices} disabled={loading}>
            {translate('phoneConnection.retryDevices', 'Retry')}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('phoneConnection.loadingDevices', 'Loading authorized devices…')}
        </p>
      ) : devices.length === 0 && !error ? (
        <p className="text-muted-foreground text-sm">
          {hasQrCode
            ? translate(
                'auto.components.settings.MobilePane.1592afcc7a',
                'No devices paired yet. Scan the QR code with the HiveCode mobile app.'
              )
            : translate('auto.components.settings.MobilePane.1b1b70279a', 'No devices paired yet.')}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {devices.map((device) => (
            <div key={device.deviceId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-medium">{device.name}</div>
                <div className="text-muted-foreground text-xs">
                  {translate('auto.components.settings.MobilePane.254a6d09e4', 'Paired')}{' '}
                  {new Date(device.pairedAt).toLocaleDateString(getIntlLocale())}
                  {device.lastSeenAt ? (
                    <>
                      {' '}
                      · {translate('phoneConnection.lastSeen', 'Last seen')}{' '}
                      {new Date(device.lastSeenAt).toLocaleString(getIntlLocale())}
                    </>
                  ) : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={revokingDeviceIds?.has(device.deviceId)}
                aria-label={translate('phoneConnection.revokeDevice', 'Revoke {{name}}', {
                  name: device.name
                })}
                onClick={() => onRevokeDevice(device.deviceId)}
                className="text-destructive hover:text-destructive"
              >
                {revokingDeviceIds?.has(device.deviceId) ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
      {devices.length > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          {translate(
            'phoneConnection.revokeDescription',
            'Revoking a QR authorization disconnects that device. Manage HiveCloud access sessions separately above.'
          )}
        </p>
      )}
    </div>
  )
}

import { translate } from '../i18n/mobile-i18n'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'
import { presentRuntimeCatalogStatus } from './runtime-selector-presentation'

export type RuntimeConnectionTone = 'success' | 'warning' | 'danger' | 'neutral'

export type RuntimeConnectionPresentation = Readonly<{
  accessibilityLabel: string
  label: string
  tone: RuntimeConnectionTone
}>

/** Compact, non-color-only connection copy for narrow mobile headers. */
export function presentRuntimeConnection(
  state: ConnectionState,
  runtime?: HostCatalogEntry
): RuntimeConnectionPresentation {
  switch (state) {
    case 'connected':
      return {
        accessibilityLabel: translate(
          'diagnostics.useTroubleshootDiagnostics.connected',
          'Connected'
        ),
        label: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.6f3345b9c1',
          'Online'
        ),
        tone: 'success'
      }
    case 'connecting':
      return {
        accessibilityLabel: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.16ec92e865',
          'Connecting'
        ),
        label: translate('hostScreen.hostListActionSheetActions.connect', 'Connect'),
        tone: 'warning'
      }
    case 'handshaking':
      return {
        accessibilityLabel: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.7c482782c7',
          'Verifying connection'
        ),
        label: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.2febb61c00',
          'Verify'
        ),
        tone: 'warning'
      }
    case 'reconnecting':
      return {
        accessibilityLabel: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.9795c9bcab',
          'Reconnecting'
        ),
        label: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.7b43a8cfcf',
          'Reconnect'
        ),
        tone: 'warning'
      }
    case 'auth-failed':
      return {
        accessibilityLabel: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.9e399d5289',
          'Pairing expired'
        ),
        label: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.6e75413aa0',
          'Expired'
        ),
        tone: 'danger'
      }
    case 'disconnected':
      if (runtime) {
        const { statusLabel, tone } = presentRuntimeCatalogStatus(runtime, state)
        return {
          accessibilityLabel: statusLabel === '在线' ? '主机在线，尚未建立连接' : statusLabel,
          label: statusLabel,
          tone
        }
      }
      return {
        accessibilityLabel: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.0d75f871c4',
          'No connection established yet'
        ),
        label: translate(
          'auto.mobile.src.runtime.directory.runtime.connection.presentation.df445ce40f',
          'Disconnected'
        ),
        tone: 'neutral'
      }
  }
}

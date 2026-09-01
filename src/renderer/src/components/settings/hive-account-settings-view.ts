import type { HiveAccountState } from '../../../../shared/hive-account'
import { getIntlLocale, translate } from '@/i18n/i18n'
import {
  currentDevicePlatformLabel,
  type HiveAccountRuntimeTone
} from './hive-account-runtime-presentation'

export type HiveAccountPlatformInfo = {
  platform: NodeJS.Platform
  osRelease: string
  arch: string
}

export function formatAccountAuthorization(value: number | undefined): string {
  if (!value) {
    return translate('auto.components.settings.orcaAccount.notAvailable', 'Not available')
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function accountSessionProfileLabel(profile: HiveAccountState['sessionProfile']): string {
  if (profile === 'TRUSTED') {
    return translate('auto.components.settings.orcaAccount.trustedSession', 'Trusted')
  }
  if (profile === 'TEMPORARY') {
    return translate('auto.components.settings.orcaAccount.temporarySession', 'Temporary')
  }
  return translate('auto.components.settings.orcaAccount.legacySession', 'Legacy session')
}

export function accountPlatformLabel(info: HiveAccountPlatformInfo | null): string {
  if (!info) {
    return currentDevicePlatformLabel(navigator.userAgent)
  }
  const name =
    info.platform === 'win32'
      ? 'Windows'
      : info.platform === 'darwin'
        ? 'macOS'
        : info.platform === 'linux'
          ? 'Linux'
          : translate('auto.components.settings.orcaAccount.desktopPlatform', 'Desktop')
  return info.osRelease ? `${name} ${info.osRelease}` : name
}

export function accountRuntimeToneClass(tone: HiveAccountRuntimeTone): string {
  if (tone === 'online') {
    return 'bg-status-success'
  }
  if (tone === 'warning') {
    return 'bg-status-warning'
  }
  if (tone === 'danger') {
    return 'bg-destructive'
  }
  return 'bg-muted-foreground/55'
}

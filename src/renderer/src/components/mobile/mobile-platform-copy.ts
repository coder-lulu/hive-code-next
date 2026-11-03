import { translate } from '@/i18n/i18n'

export type Platform = 'ios' | 'android'

export type InstallCopy = { ctaLabel: string; url: string }

export const ANDROID_INSTALL_GUIDE_URL =
  'https://github.com/coder-lulu/hive-code-next/docs/android-apk'

export function getInstallCopy(platform: Platform): InstallCopy {
  return platform === 'ios'
    ? {
        ctaLabel: translate(
          'auto.components.mobile.mobile.platform.copy.openAppStore',
          'Open App Store'
        ),
        url: 'https://apps.apple.com/app/orca-ide/id6766130217'
      }
    : {
        ctaLabel: translate(
          'auto.components.mobile.mobile.platform.copy.downloadApk',
          'Download APK'
        ),
        url: 'https://github.com/coder-lulu/hive-code-next/download/android'
      }
}

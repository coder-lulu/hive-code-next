import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'
import { PRODUCT_PUBLIC_LINKS } from '@/product-links'

// iOS ships two App Store tracks: the public App Store build (slower, ~weekly)
// and the TestFlight preview build (daily). Android only ships one APK track.
export type IosChannel = 'stable' | 'preview'

export type InstallCopy = { ctaLabel: string; url: string | null }

export const ANDROID_INSTALL_GUIDE_URL = PRODUCT_PUBLIC_LINKS.documentation

const IOS_CHANNEL_COPY: Record<IosChannel, InstallCopy> = {
  stable: {
    ctaLabel: 'Open App Store',
    url: PRODUCT_PUBLIC_LINKS.iosDownload
  },
  preview: {
    ctaLabel: 'Open TestFlight',
    url: null
  }
}

const ANDROID_COPY: InstallCopy = {
  ctaLabel: 'Download APK',
  url: PRODUCT_PUBLIC_LINKS.androidDownload
}

export function getInstallCopy(platform: Platform, iosChannel: IosChannel): InstallCopy {
  return platform === 'ios' ? IOS_CHANNEL_COPY[iosChannel] : ANDROID_COPY
}

export function getChannelTagline(iosChannel: IosChannel): string {
  return iosChannel === 'preview'
    ? translate(
        'auto.components.mobile.mobile.platform.copy.preview.tagline',
        'Newest features, updated daily.'
      )
    : translate(
        'auto.components.mobile.mobile.platform.copy.stable.tagline',
        'The public release, updated weekly.'
      )
}

import { translate, type Translate } from '../i18n/mobile-i18n'
export type MobileHomeConnectionMethod = 'scan' | 'account'

export const mobileHomeConnectionContent = {
  scan: {
    get title() {
      return translate(
        'auto.mobile.src.home.mobile.home.connection.content.47e673dc08',
        'Computer nearby'
      )
    },
    get description() {
      return translate(
        'auto.mobile.src.home.mobile.home.connection.content.3728931acc',
        'Display the QR code on your computer and scan it with your phone.'
      )
    },
    help: '连接遇到问题？',
    steps: [
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.c562bf86be',
            'Open HiveCode on your computer'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.5923b905d1',
            'Show the pairing QR code in connection settings'
          )
        }
      },
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.4269bc3305',
            'Scan the QR code with your phone'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.79c5c87dab',
            'Tap the button above to scan your computer screen'
          )
        }
      },
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.d2488db425',
            'Keep working after connecting'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.e1b16f308f',
            'View sessions and open terminals'
          )
        }
      }
    ]
  },
  account: {
    get title() {
      return translate(
        'auto.mobile.src.home.mobile.home.connection.content.858d486b51',
        'Choose a computer from your account'
      )
    },
    get description() {
      return translate(
        'auto.mobile.src.home.mobile.home.connection.content.3b614e82a3',
        'Sign in to HiveCloud to view and connect to claimed computers.'
      )
    },
    help: '如何认领电脑？',
    steps: [
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.da46c45350',
            'Sign in to your HiveCloud account'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.49e0408fdf',
            'Sign in with your HiveCloud account'
          )
        }
      },
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.4363bd38db',
            'Choose a claimed computer'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.8488b764f7',
            'View available devices in your account'
          )
        }
      },
      {
        get title() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.d2488db425',
            'Keep working after connecting'
          )
        },
        get description() {
          return translate(
            'auto.mobile.src.home.mobile.home.connection.content.e337d058ef',
            'Open sessions and terminals on your computer'
          )
        }
      }
    ]
  }
} as const

export function homeAlerts(
  t: Translate
): Record<
  'unavailable' | 'pairingFailure' | 'offline' | 'cloudUnavailable' | 'removeFailure',
  [string, string]
> {
  return {
    unavailable: [
      t('home.runtimeUnavailable', 'Runtime is unavailable'),
      t(
        'home.runtimeUnverified',
        'Task status cannot be verified until the connection recovers. Tasks will not run on a different computer.'
      )
    ],
    pairingFailure: [
      t('home.screen.pairingCheckFailed', 'Could not check pairing'),
      t('home.screen.tryAgain', 'Please try again.')
    ],
    offline: [
      t('home.runtimeOffline', 'Runtime offline'),
      t('home.runtimeReconnect', 'This Runtime will be available when it reconnects to HiveCloud.')
    ],
    cloudUnavailable: [
      t('home.relayUnavailable', 'Cloud connection unavailable'),
      t('home.relayNotAdvertised', 'This Runtime is not advertising a mobile Relay route yet.')
    ],
    removeFailure: [
      t('home.screen.removeHostFailed', 'Could not remove host'),
      t('home.screen.tryAgain', 'Please try again.')
    ]
  }
}

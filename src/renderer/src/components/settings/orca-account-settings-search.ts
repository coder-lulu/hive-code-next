import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getOrcaAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.orcaAccount.title', 'Account & cloud'),
    description: translate(
      'auto.components.settings.orcaAccount.searchDescription',
      'Manage your HiveCloud identity, usage, sign-in devices and security.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordDevice', 'device'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordSession', 'session'),
      ...translateSearchKeyword('auto.components.settings.orcaAccount.keywordCloud', 'cloud')
    ]
  }
])

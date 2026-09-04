import { browserGuestRegistrationAndDownloadsApi } from './browser-bridge-guest-registration-and-downloads'
import { browserPageInteractionAndSessionsApi } from './browser-bridge-page-interaction-and-sessions'
import type { PreloadApi } from '../api-types'

export const browserApi: PreloadApi['browser'] = {
  ...browserGuestRegistrationAndDownloadsApi,
  ...browserPageInteractionAndSessionsApi
}

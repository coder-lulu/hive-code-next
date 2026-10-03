import { APP_DISPLAY_NAME } from './brand'

export const APP_ICON_OPTIONS = [{ id: 'classic', label: APP_DISPLAY_NAME }] as const

// Legacy IDs remain valid persisted values, but they resolve to the approved
// product icon and are no longer exposed as selectable branding.
export type AppIconId = 'classic' | 'watercolor' | 'blue'

export const DEFAULT_APP_ICON_ID: AppIconId = 'classic'

export function normalizeAppIconId(value: unknown): AppIconId {
  return value === 'classic' || value === 'watercolor' || value === 'blue'
    ? value
    : DEFAULT_APP_ICON_ID
}

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateSessionInWorkspace } from '@/lib/session-navigation'
import type { SessionListItem } from './session-list-types'

export function useOpenSession() {
  const [openingKey, setOpeningKey] = useState<string | null>(null)
  const openSession = useCallback(async (item: SessionListItem) => {
    setOpeningKey(item.key)
    try {
      const result = await activateSessionInWorkspace(item)
      if (!result.ok) {
        toast.info(
          result.reason === 'disconnected'
            ? translate(
                'components.sessions.openDisconnected',
                'Reconnect this host, then try opening the session again.'
              )
            : translate(
                'components.sessions.openUnavailable',
                'This session is no longer available in the current workspace. Refresh its host and try again.'
              )
        )
      }
    } catch {
      toast.error(
        translate(
          'components.sessions.openFailed',
          'Could not open this session. Please try again.'
        )
      )
    } finally {
      setOpeningKey(null)
    }
  }, [])
  return { openingKey, openSession }
}

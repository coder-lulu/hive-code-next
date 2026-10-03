import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import {
  useConfirmationDialog,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { isFloatingTerminalWorkspaceId } from '@/lib/floating-terminal'
import { deleteTemporarySession } from '@/lib/temporary-session-actions'
import { activateTemporarySessionInMain } from '@/lib/temporary-session-navigation'
import { useAppStore } from '@/store'
import {
  temporarySessionIdentityKey,
  type TemporarySessionItem
} from './use-temporary-session-collection'

export async function confirmTemporarySessionDeletion(
  item: TemporarySessionItem,
  confirm: ConfirmationDialogContextValue,
  onConfirmed: (item: TemporarySessionItem) => void
): Promise<boolean> {
  const confirmed = await confirm({
    title: translate('components.sidebar.sessions.deleteConfirmTitle', 'Delete temporary session?'),
    description: translate(
      'components.sidebar.sessions.deleteConfirmDescription',
      '“{{title}}” will be removed from Temporary sessions. Any running task may be stopped. This action cannot be undone.',
      { title: item.title }
    ),
    confirmLabel: translate('components.sidebar.sessions.deleteConfirmAction', 'Delete'),
    confirmVariant: 'destructive'
  })
  if (!confirmed) {
    return false
  }
  onConfirmed(item)
  return true
}

export function activateTemporarySession(item: TemporarySessionItem): void {
  const state = useAppStore.getState()
  const consumeCompletion = (): void => {
    if (item.paneKey) {
      state.consumeAgentCompletionUnread(item.paneKey)
    } else if (item.tabId) {
      state.consumeFirstAgentCompletionUnreadForTab(item.tabId)
    }
  }

  if (
    !isFloatingTerminalWorkspaceId(item.worktreeId) ||
    !activateTemporarySessionInMain({
      ownerBucketKey: item.ownerBucketKey,
      sessionId: item.id,
      unifiedTabId: item.unifiedTabId,
      terminalTabId: item.terminalTabId,
      tabId: item.tabId,
      executionHostId: item.executionHostId
    })
  ) {
    toast.info(
      translate(
        'components.sidebar.sessions.restoreUnavailable',
        'This session is not available to restore. You can delete it from the temporary list.'
      )
    )
    return
  }
  consumeCompletion()
}

export function useTemporarySessionListActions(): {
  deletingSessionKeys: ReadonlySet<string>
  openSession: (item: TemporarySessionItem) => void
  requestDelete: (item: TemporarySessionItem) => void
} {
  const confirm = useConfirmationDialog()
  const [deletingSessionKeys, setDeletingSessionKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const deleteSession = useCallback((item: TemporarySessionItem): void => {
    const key = temporarySessionIdentityKey(item)
    setDeletingSessionKeys((current) => new Set(current).add(key))
    void deleteTemporarySession({
      ownerBucketKey: item.ownerBucketKey,
      sessionId: item.id,
      unifiedTabId: item.unifiedTabId,
      terminalTabId: item.terminalTabId,
      tabId: item.tabId,
      paneKey: item.paneKey,
      executionHostId: item.executionHostId
    })
      .then((deleted) => {
        if (!deleted) {
          toast.info(
            translate(
              'components.sidebar.sessions.alreadyRemoved',
              'This temporary session is no longer available.'
            )
          )
        }
      })
      .catch((error: unknown) => {
        console.error('Could not delete temporary session', error)
        toast.error(
          translate(
            'components.sidebar.sessions.deleteFailed',
            'Could not delete the temporary session.'
          )
        )
      })
      .finally(() => {
        setDeletingSessionKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      })
  }, [])

  const requestDelete = useCallback(
    (item: TemporarySessionItem): void => {
      void confirmTemporarySessionDeletion(item, confirm, deleteSession)
    },
    [confirm, deleteSession]
  )

  return {
    deletingSessionKeys,
    openSession: activateTemporarySession,
    requestDelete
  }
}

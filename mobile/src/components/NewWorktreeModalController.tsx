import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'

import type { RpcClient } from '../transport/rpc-client'
import type { WorkspaceRuntimeSelection } from './new-worktree-modal-types'
import { NewWorktreeModal } from './NewWorktreeModal'

export type NewWorktreeModalControllerHandle = {
  open: () => void
}

type Props = {
  runtimeSelection?: WorkspaceRuntimeSelection
  routeVisible: boolean
  client: RpcClient | null
  hostId?: string
  existingWorktreePaths?: readonly string[]
  existingWorktrees?: readonly { repoId: string; branch: string }[]
  openExternalUrl: (url: string) => Promise<unknown>
  onVisibleChange?: (visible: boolean) => void
  onRouteVisibleChange: (visible: boolean) => void
  onCreated: (worktreeId: string, name: string, warning?: string) => void
}

export const NewWorktreeModalController = forwardRef<NewWorktreeModalControllerHandle, Props>(
  function NewWorktreeModalController(
    {
      runtimeSelection,
      routeVisible,
      client,
      hostId,
      existingWorktreePaths,
      existingWorktrees,
      openExternalUrl,
      onVisibleChange,
      onRouteVisibleChange,
      onCreated
    },
    ref
  ) {
    const [manualVisible, setManualVisible] = useState(false)
    const visible = routeVisible || manualVisible

    useImperativeHandle(
      ref,
      () => ({
        open: () => setManualVisible(true)
      }),
      []
    )

    const close = useCallback(() => {
      setManualVisible(false)
      if (routeVisible) {
        onRouteVisibleChange(false)
      }
    }, [onRouteVisibleChange, routeVisible])

    useEffect(() => {
      onVisibleChange?.(visible)
    }, [onVisibleChange, visible])

    return (
      <NewWorktreeModal
        runtimeSelection={runtimeSelection}
        visible={visible}
        client={client}
        hostId={hostId}
        existingWorktreePaths={existingWorktreePaths}
        existingWorktrees={existingWorktrees}
        openExternalUrl={openExternalUrl}
        onCreated={onCreated}
        onClose={close}
      />
    )
  }
)

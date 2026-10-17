import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'

import type { NewWorktreeModalProps, WorkspaceRuntimeSelection } from './new-worktree-modal-types'
import type { ExecutionHostId } from '../../../src/shared/execution-host'
import { NewWorktreeModal } from './NewWorktreeModal'

export type NewWorktreeModalControllerHandle = {
  open: () => void
}

type Props = Omit<NewWorktreeModalProps, 'visible' | 'onClose' | 'hostLabelById'> & {
  /** Names for execution targets served by the selected host. */
  hostLabelById: ReadonlyMap<ExecutionHostId, string>
  runtimeSelection?: WorkspaceRuntimeSelection
  routeVisible: boolean
  onVisibleChange?: (visible: boolean) => void
  onRouteVisibleChange: (visible: boolean) => void
}

export const NewWorktreeModalController = forwardRef<NewWorktreeModalControllerHandle, Props>(
  function NewWorktreeModalController(
    {
      runtimeSelection,
      routeVisible,
      client,
      hostId,
      hostLabelById,
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
        hostLabelById={hostLabelById}
        existingWorktreePaths={existingWorktreePaths}
        existingWorktrees={existingWorktrees}
        openExternalUrl={openExternalUrl}
        onCreated={onCreated}
        onClose={close}
      />
    )
  }
)

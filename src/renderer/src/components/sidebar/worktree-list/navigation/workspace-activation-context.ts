import { createContext } from 'react'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'

/** Notify an enclosing management surface only after navigation succeeds. */
export const WorkspaceActivatedContext = createContext<(() => void) | undefined>(undefined)

/** A navigation surface can replace terminal activation without moving the execution owner. */
export type OpenWorkspaceInSurface = (worktreeId: string, executionHostId: ExecutionHostId) => void
export const OpenWorkspaceInSurfaceContext = createContext<OpenWorkspaceInSurface | undefined>(
  undefined
)

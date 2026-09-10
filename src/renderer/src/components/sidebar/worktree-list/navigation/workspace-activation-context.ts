import { createContext } from 'react'

/** Notify an enclosing management surface only after navigation succeeds. */
export const WorkspaceActivatedContext = createContext<(() => void) | undefined>(undefined)

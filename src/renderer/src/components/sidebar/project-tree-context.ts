import { createContext, useContext } from 'react'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { WorktreeAgentExpansionControls } from './worktree-card-agents-expansion-state'

export const ProjectTreeContext = createContext(false)
export const useProjectTree = () => useContext(ProjectTreeContext)

export const ProjectWorkspaceDisclosureContext = createContext<{
  agents: DashboardAgentRow[]
  expansion: WorktreeAgentExpansionControls
} | null>(null)

export const useProjectWorkspaceDisclosure = () => useContext(ProjectWorkspaceDisclosureContext)

import type { TaskCodexAccountScope } from './task-codex-account-scope'

export type TaskCodexRuntimeAccountPorts = Readonly<{
  resolveSelected: () => TaskCodexAccountScope
  resolvePinned: (home: string) => TaskCodexAccountScope
  subscribe?: (listener: () => void) => () => void
}>

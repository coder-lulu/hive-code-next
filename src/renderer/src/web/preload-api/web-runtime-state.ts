import type {
  GlobalSettings,
  WorktreeVisibilityDefaults
} from '../../../../shared/global-settings-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WebAccountBootstrap } from '../account-runtime-relay/WebAccountConnect'
import type { WebAccountRuntimeClient } from '../account-runtime-relay/web-account-relay-client'
import type { CloudLaunchBootstrap } from '../cloud-launch-bootstrap'
import {
  readStoredWebRuntimeEnvironment,
  type StoredWebRuntimeEnvironment
} from '../web-runtime-environment'

export const webRuntimeState: {
  activeEnvironment: StoredWebRuntimeEnvironment | null
  activeCloudBootstrap: CloudLaunchBootstrap | null
  activeAccountBootstrap: WebAccountBootstrap | null
  worktreeVisibilityDefaultsRuntimeEnvironmentId: string | null
  worktreeVisibilityDefaultsRuntimeValue: WorktreeVisibilityDefaults | null
  zcodePlanSiteRuntimeOwner: string | null
  zcodePlanSiteRuntimeValue: GlobalSettings['zcodePlanSite'] | null
  activeClient: WebAccountRuntimeClient | null
  activeClientEnvironmentId: string | null
  cachedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null
  cachedDetectedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null
} = {
  activeEnvironment: readStoredWebRuntimeEnvironment(),
  activeCloudBootstrap: null,
  activeAccountBootstrap: null,
  worktreeVisibilityDefaultsRuntimeEnvironmentId: null,
  worktreeVisibilityDefaultsRuntimeValue: null,
  zcodePlanSiteRuntimeOwner: null,
  zcodePlanSiteRuntimeValue: null,
  activeClient: null,
  activeClientEnvironmentId: null,
  cachedWorktrees: null,
  cachedDetectedWorktrees: null
}

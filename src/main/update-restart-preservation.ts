import {
  preserveAgentAuthBeforeRestart,
  type CodexRuntimeAuthSync,
  type ClaudeRuntimeAuthSync
} from './agent-auth-restart-preservation'
import type { Store } from './persistence'

/** Before any update restart, desktop or headless serve: save agent auth, then a full store checkpoint. */
export async function preserveStateBeforeUpdateRestart({
  codexRuntimeHome,
  claudeRuntimeAuth,
  store
}: {
  codexRuntimeHome: CodexRuntimeAuthSync | null | undefined
  claudeRuntimeAuth?: ClaudeRuntimeAuthSync | null
  store: Pick<Store, 'flushPendingOrThrowAsync'>
}): Promise<void> {
  await preserveAgentAuthBeforeRestart({ codexRuntimeHome, claudeRuntimeAuth, store })
  await store.flushPendingOrThrowAsync({ fullCheckpoint: true })
}

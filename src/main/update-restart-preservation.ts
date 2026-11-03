import {
  preserveAgentAuthBeforeRestart,
  type CodexRuntimeAuthSync,
  type ClaudeRuntimeAuthSync
} from './agent-auth-restart-preservation'
import type { Store } from './persistence/loading-store/store'

// Save agent auth before checkpointing the store on desktop and headless restarts.
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

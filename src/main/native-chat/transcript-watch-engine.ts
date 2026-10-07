import type { NativeChatMessage, NativeChatTurnLifecycle } from '../../shared/native-chat-types'
import {
  boundaryFingerprint,
  readTranscriptFileVersion,
  transcriptFileVersionChanged,
  type TranscriptFileVersion
} from './transcript-file-version'
import {
  createIncrementalTranscriptState,
  readIncrementalTranscriptMessages,
  resetIncrementalTranscriptState
} from './transcript-incremental-reader'
import { readNativeChatTranscriptTailFile } from './transcript-tail-reader'
import { emitTranscriptUnavailableSnapshot } from './transcript-unavailable-snapshot'
import { transcriptWatcherPathIsInstallable } from './transcript-watcher-install-probe'
import { nativeChatTurnLifecycleDecoderForAgent } from './transcript-turn-lifecycle'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'
import { createTranscriptWatchScheduler } from './transcript-watch-scheduler'
import { WslTranscriptFsError } from './wsl-transcript-fs-gate'
import {
  createRunningGuardedTranscriptNativeWatcher,
  isWslTranscriptWatcherPath,
  transcriptWatcherPathIsRunning
} from './wsl-transcript-watcher-running-guard'
import { observeWslTranscriptRunningState } from './wsl-transcript-running-observer'
import { trackActiveNativeChatWatcher } from './transcript-watcher-count'

/** Install a live tail, or return null when the resolved file is not readable yet. */
export async function installTranscriptWatcher(
  filePath: string,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null,
  args: SubscribeNativeChatTranscriptArgs,
  signal?: AbortSignal
): Promise<NativeChatTranscriptSubscription | null> {
  const isWslPath = isWslTranscriptWatcherPath(filePath)
  if (!(await transcriptWatcherPathIsInstallable(filePath, signal))) {
    return null
  }
  const { onAppend, onInitialSnapshot, onReplace, initialLimit } = args
  const decodeLifecycle = nativeChatTurnLifecycleDecoderForAgent(args.agent)

  const state = createIncrementalTranscriptState()
  let watchedVersion: TranscriptFileVersion | null = null
  let watchedBoundary = ''
  let initialDrain = true,
    initialErrorEmitted = false
  let closed = false
  // Why: every gated call on the drain path must detach the moment we
  // unsubscribe, instead of holding a waiter until its 30s deadline, and an
  // aborted signal also makes the gate refuse admission for anything the
  // in-flight drain would start after teardown.
  const gateAbort = new AbortController()
  let reading = false
  let pendingReadRequested = false
  let rotationRetryCount = 0

  function scheduleRotationRetry(): void {
    if (closed) {
      return
    }
    const retryDelay = Math.min(25 * 2 ** Math.min(rotationRetryCount, 7), 2_000)
    if (scheduler.scheduleRetry(retryDelay)) {
      rotationRetryCount += 1
    }
  }

  async function readAndEmitAppends(): Promise<void> {
    let lifecycle: NativeChatTurnLifecycle | undefined
    const remaining = await readIncrementalTranscriptMessages(
      filePath,
      state,
      decode,
      (messages) => {
        if (!closed) {
          onAppend(messages)
        }
      },
      decodeLifecycle ?? undefined,
      (nextLifecycle) => {
        lifecycle = nextLifecycle
      },
      gateAbort.signal
    )
    if (!closed && (remaining.length > 0 || lifecycle)) {
      onAppend(remaining, lifecycle)
    }
  }

  async function finishSuccessfulDrain(startVersion: TranscriptFileVersion): Promise<void> {
    watchedBoundary = await boundaryFingerprint(filePath, state.offset, gateAbort.signal)
    const completedVersion = await readTranscriptFileVersion(filePath, gateAbort.signal)
    if (transcriptFileVersionChanged(completedVersion, startVersion)) {
      // Reconcile versions changed after the stable read instead of accepting unread content.
      watchedVersion = startVersion
      pendingReadRequested = true
    } else {
      watchedVersion = completedVersion
    }
    if (closed) {
      return
    }
    if (!nativeWatcher.needsRebind() || nativeWatcher.bind()) {
      rotationRetryCount = 0
      return
    }
    if (!isWslPath) {
      scheduleRotationRetry()
    }
  }

  async function drainOnce(): Promise<void> {
    const current = await readTranscriptFileVersion(filePath, gateAbort.signal)
    const currentBoundary = await boundaryFingerprint(filePath, state.offset, gateAbort.signal)
    if (closed) {
      return
    }
    const identityChanged = watchedVersion !== null && current.identity !== watchedVersion.identity
    const sameSizeVersionChanged =
      watchedVersion !== null &&
      current.identity === watchedVersion.identity &&
      current.size === watchedVersion.size &&
      transcriptFileVersionChanged(current, watchedVersion)
    const contentReplaced =
      identityChanged ||
      sameSizeVersionChanged ||
      current.size < state.offset ||
      (state.offset > 0 && watchedBoundary !== currentBoundary)
    if (identityChanged) {
      nativeWatcher.invalidate()
    }
    const needsReplacementSnapshot =
      contentReplaced && !initialDrain && onReplace && initialLimit !== undefined
    const needsInitialSnapshot = initialDrain && onInitialSnapshot && initialLimit !== undefined
    // An explicit undefined check preserves the valid zero-message window.
    const snapshot =
      (needsReplacementSnapshot || needsInitialSnapshot) && initialLimit !== undefined
        ? await readNativeChatTranscriptTailFile(
            filePath,
            initialLimit,
            decode,
            false,
            undefined,
            decodeLifecycle,
            gateAbort.signal
          )
        : null
    if (closed) {
      return
    }
    if (snapshot) {
      const readVersion = await readTranscriptFileVersion(filePath, gateAbort.signal)
      if (closed) {
        return
      }
      if (transcriptFileVersionChanged(readVersion, current)) {
        pendingReadRequested = true
        return
      }
    }
    if (contentReplaced) {
      resetIncrementalTranscriptState(state)
    }
    // Subscriber callbacks may replace the path before the drain finishes.
    watchedVersion ??= current
    if (needsReplacementSnapshot && snapshot && onReplace) {
      state.offset = snapshot.consumedTo
      state.pendingStart = state.offset
      onReplace(snapshot.messages, snapshot.hasMore, snapshot.beforeOffset, snapshot.lifecycle)
      await readAndEmitAppends()
      await finishSuccessfulDrain(current)
      return
    }

    if (initialDrain && onInitialSnapshot) {
      initialDrain = false
      if (snapshot) {
        state.offset = snapshot.consumedTo
        state.pendingStart = state.offset
        onInitialSnapshot(
          snapshot.messages,
          snapshot.hasMore,
          snapshot.beforeOffset,
          undefined,
          snapshot.lifecycle
        )
        await readAndEmitAppends()
      } else {
        let lifecycle: NativeChatTurnLifecycle | undefined
        const messages = await readIncrementalTranscriptMessages(
          filePath,
          state,
          decode,
          undefined,
          decodeLifecycle ?? undefined,
          (nextLifecycle) => {
            lifecycle = nextLifecycle
          },
          gateAbort.signal
        )
        if (closed) {
          return
        }
        onInitialSnapshot(messages, false, 0, undefined, lifecycle)
      }
    } else {
      initialDrain = false
      await readAndEmitAppends()
    }
    await finishSuccessfulDrain(current)
  }

  async function drain(runningChecked = false): Promise<void> {
    if (closed) {
      return
    }
    if (isWslPath && !runningChecked && !(await transcriptWatcherPathIsRunning(filePath))) {
      nativeWatcher.invalidate()
      initialErrorEmitted ||=
        !closed && initialDrain && emitTranscriptUnavailableSnapshot(onInitialSnapshot)
      return
    }
    if (reading) {
      pendingReadRequested = true
      return
    }
    reading = true
    try {
      do {
        pendingReadRequested = false
        try {
          await drainOnce()
        } catch (error) {
          // Why: unlink/recreate can detach fs.watch from the pathname. Keep one
          // capped-backoff retry alive until a successor appears or we unsubscribe.
          // A still-pending initial drain also surfaces one error snapshot so a
          // watching client isn't stranded at 'loading' when the read keeps
          // throwing; initialDrain stays true so a recovered read can still win.
          initialErrorEmitted ||=
            !closed &&
            initialDrain &&
            emitTranscriptUnavailableSnapshot(
              onInitialSnapshot,
              error instanceof WslTranscriptFsError ? error.message : 'Transcript unavailable'
            )
          if (!isWslPath) {
            scheduleRotationRetry()
          }
          break
        }
      } while (pendingReadRequested && !closed)
    } finally {
      reading = false
    }
  }

  async function reconcileKnownRunning(): Promise<void> {
    if (closed) {
      return
    }
    try {
      const current = await readTranscriptFileVersion(filePath, gateAbort.signal)
      if (closed) {
        return
      }
      const versionChanged =
        watchedVersion === null || transcriptFileVersionChanged(current, watchedVersion)
      if (versionChanged || current.size !== state.offset || nativeWatcher.needsRebind()) {
        await drain(true)
      }
    } catch {
      // WSL retries wait for the next shared running-state observation.
      await (isWslPath ? undefined : drain())
    }
  }

  const scheduler = createTranscriptWatchScheduler({
    debounceMs: args.debounceMs,
    reconciliationIntervalMs: args.reconciliationIntervalMs,
    drain: () => void drain(),
    reconcile: reconcileKnownRunning
  })
  const nativeWatcher = createRunningGuardedTranscriptNativeWatcher(
    filePath,
    () => scheduler.scheduleEventDrain(),
    scheduleRotationRetry
  )

  nativeWatcher.bind()
  const stopWslObservation = isWslPath
    ? observeWslTranscriptRunningState(
        filePath,
        () => reconcileKnownRunning(),
        () => nativeWatcher.invalidate()
      )
    : () => {}
  trackActiveNativeChatWatcher(1)
  if (!isWslPath) {
    scheduler.startReconciliation()
  }
  scheduler.scheduleEventDrain()

  return {
    watching: true,
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      gateAbort.abort(new Error('Native Chat transcript watcher unsubscribed'))
      scheduler.dispose()
      stopWslObservation()
      nativeWatcher.dispose()
      trackActiveNativeChatWatcher(-1)
    }
  }
}

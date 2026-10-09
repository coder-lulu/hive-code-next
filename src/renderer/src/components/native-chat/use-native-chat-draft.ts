import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { appendReturnedDraftText } from '../../../../shared/returned-draft-text'
import { subscribeToNativeChatComposerDraft } from './native-chat-composer-draft-store'
import {
  readNativeChatDraftCache,
  subscribeToNativeChatDraftAppend,
  writeNativeChatDraftCache
} from './native-chat-draft-cache'

/** Text appended mid-IME-composition: saved at once, shown once the composition settles. */
type CompositionHold = { scopeKey: string; shown: string; appended: string }

/**
 * The composer's draft text, read from the draft store so a typed-but-unsent message survives
 * the composer unmounting on a TUI/GUI toggle, a reload or a quit. Every change is made to the
 * store's current draft, never to a copy this composer holds. `scopeKey` is the stable pane key
 * also used for image attachments.
 */
export function useNativeChatDraft(
  scopeKey: string,
  isComposing: () => boolean,
  controlled?: { text: string; onChange: (text: string) => void }
): {
  draft: string
  setDraft: (next: string | ((previous: string) => string), options?: { unsaved?: boolean }) => void
  /** Shows text appended during an IME composition, which owns the field until it settles. */
  flushDraftAppends: () => void
} {
  const controlledRef = useRef(controlled)
  controlledRef.current = controlled
  const subscribe = useCallback(
    (listener: () => void) => subscribeToNativeChatComposerDraft(scopeKey, listener),
    [scopeKey]
  )
  const stored = useSyncExternalStore(subscribe, () => readNativeChatDraftCache(scopeKey))
  const [hold, setHold] = useState<CompositionHold | null>(null)
  // Read by callbacks between renders; only they change it, always together with the state.
  const holdRef = useRef<CompositionHold | null>(null)
  const updateHold = useCallback((next: CompositionHold | null) => {
    holdRef.current = next
    setHold(next)
  }, [])
  useEffect(
    () => () => {
      holdRef.current = null
    },
    []
  )

  useEffect(
    () =>
      subscribeToNativeChatDraftAppend(scopeKey, (text, previous) => {
        if (!isComposing()) {
          const owner = controlledRef.current
          if (owner) {
            owner.onChange(appendReturnedDraftText(owner.text, text))
          }
          return
        }
        const held = holdRef.current?.scopeKey === scopeKey ? holdRef.current : null
        updateHold({
          scopeKey,
          shown: held ? held.shown : previous,
          appended: held ? appendReturnedDraftText(held.appended, text) : text
        })
      }),
    [isComposing, scopeKey, updateHold]
  )

  // Accepts the same value/updater forms as a useState setter so call sites are drop-in.
  const setDraft = useCallback(
    (next: string | ((previous: string) => string), options?: { unsaved?: boolean }) => {
      const held = holdRef.current?.scopeKey === scopeKey ? holdRef.current : null
      const previous = held ? held.shown : (controlled?.text ?? readNativeChatDraftCache(scopeKey))
      const resolved = typeof next === 'function' ? next(previous) : next
      if (held) {
        updateHold({ ...held, shown: resolved })
      }
      if (controlled) {
        controlled.onChange(resolved)
        return
      }
      writeNativeChatDraftCache(
        scopeKey,
        held ? appendReturnedDraftText(resolved, held.appended) : resolved,
        options
      )
    },
    [scopeKey, updateHold, controlled]
  )

  const flushDraftAppends = useCallback(() => {
    if (holdRef.current?.scopeKey === scopeKey) {
      const held = holdRef.current
      if (controlledRef.current) {
        controlledRef.current.onChange(appendReturnedDraftText(held.shown, held.appended))
      }
      updateHold(null)
    }
  }, [scopeKey, updateHold])

  const shownHold = hold?.scopeKey === scopeKey ? hold : null
  return {
    draft: shownHold ? shownHold.shown : (controlled?.text ?? stored),
    setDraft,
    flushDraftAppends
  }
}

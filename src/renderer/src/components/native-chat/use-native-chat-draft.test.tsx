// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useNativeChatDraft } from './use-native-chat-draft'
import { appendNativeChatDraftCache, readNativeChatDraftCache } from './native-chat-draft-cache'

it('uses externally owned drafts without copying private text into the native pane cache', () => {
  const onChange = vi.fn()
  const { result, rerender } = renderHook(
    ({ text }) => useNativeChatDraft('owned-draft', () => false, { text, onChange }),
    { initialProps: { text: 'initial' } }
  )
  expect(result.current.draft).toBe('initial')
  act(() => result.current.setDraft((previous) => `${previous} edited`))
  expect(onChange).toHaveBeenCalledWith('initial edited')
  expect(readNativeChatDraftCache('owned-draft')).toBe('')
  rerender({ text: '' })
  expect(result.current.draft).toBe('')
})

it('holds restored text until IME settles without caching the owned draft', () => {
  const onChange = vi.fn()
  const isComposing = () => true
  const { result, rerender } = renderHook(
    ({ text }) => useNativeChatDraft('owned-ime-draft', isComposing, { text, onChange }),
    { initialProps: { text: 'private input' } }
  )
  act(() => appendNativeChatDraftCache('owned-ime-draft', 'restored prompt'))
  expect(onChange).not.toHaveBeenCalled()
  act(() => result.current.setDraft('private IME input'))
  expect(onChange).toHaveBeenLastCalledWith('private IME input')
  rerender({ text: 'private IME input' })
  act(() => result.current.flushDraftAppends())
  expect(onChange).toHaveBeenLastCalledWith('private IME input\n\nrestored prompt')
  expect(readNativeChatDraftCache('owned-ime-draft')).toBe('restored prompt')
})

it('appends to the latest owned draft through its owner callback', () => {
  const onChange = vi.fn()
  const notComposing = () => false
  const { rerender } = renderHook(
    ({ text }) => useNativeChatDraft('owned-append-draft', notComposing, { text, onChange }),
    { initialProps: { text: 'previous private input' } }
  )
  rerender({ text: 'current private input' })
  act(() => appendNativeChatDraftCache('owned-append-draft', 'restored prompt'))
  expect(onChange).toHaveBeenLastCalledWith('current private input\n\nrestored prompt')
  expect(readNativeChatDraftCache('owned-append-draft')).toBe('restored prompt')
})

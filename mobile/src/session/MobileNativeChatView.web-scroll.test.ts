import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  platform,
  assistantTurn,
  chatViewElement,
  scrollToEnd,
  scrollToOffset,
  scrollToIndex,
  type Overrides
} from './mobile-native-chat-view-test-fixture'
describe('MobileNativeChatView', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) =>
      clearTimeout(handle)
    )
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    scrollToEnd.mockReset()
    scrollToOffset.mockReset()
    scrollToIndex.mockReset()
    vi.unstubAllGlobals()
  })

  async function render(overrides: Overrides = {}): Promise<void> {
    await act(async () => {
      renderer = create(chatViewElement(overrides))
    })
  }

  function list(): ReactTestInstance {
    return renderer!.root.find((node) => String(node.type) === 'FlatList')
  }
  describe('on the page, where the list reports no drag or momentum', () => {
    beforeEach(() => {
      platform.OS = 'web'
    })

    afterEach(() => {
      platform.OS = 'ios'
    })

    function scrolledTo(y: number, contentHeight: number) {
      return {
        nativeEvent: {
          contentOffset: { y },
          contentSize: { height: contentHeight },
          layoutMeasurement: { height: 500 }
        }
      }
    }

    it.each(['onWheel', 'onTouchMove', 'onPointerDown', 'onKeyDown'])(
      'keeps a message jump separate from reader scrolling until %s input',
      async (input) => {
        const folded = [assistantTurn('a1', 'History')]
        const onLoadEarlier = vi.fn()
        await render({ folded, hasMore: true, onLoadEarlier })
        act(() => list().props.onScroll(scrolledTo(500, 1_000)))
        act(() => {
          list().props.renderItem({ item: folded[0], index: 0 }).props.onScrollToMessage(0)
        })
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, viewPosition: 0, animated: true })
        scrollToOffset.mockClear()
        act(() => {
          list().props.onKeyDown({ key: 'a' })
          list().props.onScroll(scrolledTo(300, 1_000))
          list().props.onScroll(scrolledTo(10, 1_000))
          list().props.onContentSizeChange(320, 1_200)
        })
        expect(onLoadEarlier).not.toHaveBeenCalled()
        expect(scrollToOffset).not.toHaveBeenCalled()
        act(() => {
          list().props[input]({ key: 'ArrowUp' })
          list().props.onScroll(scrolledTo(5, 1_200))
        })
        expect(onLoadEarlier).toHaveBeenCalledOnce()
        act(() => {
          list().props.onScroll(scrolledTo(700, 1_200))
          list().props.onContentSizeChange(320, 1_400)
        })
        expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 1_400 })
      }
    )

    it('stops following when the reader scrolls up, and resumes at the end', async () => {
      await render({ folded: [assistantTurn('a1', 'Latest')] })
      act(() => {
        list().props.onContentSizeChange(320, 1_000)
        list().props.onScroll(scrolledTo(500, 1_000))
      })
      scrollToOffset.mockClear()

      // No drag event arrives on the page: the move up is all there is to go on.
      act(() => {
        list().props.onScroll(scrolledTo(300, 1_000))
        list().props.onContentSizeChange(320, 1_200)
      })
      expect(scrollToOffset).not.toHaveBeenCalled()
      expect(
        renderer!.root.findAll((node) => node.props.accessibilityLabel === '滚动到最新消息')
      ).toHaveLength(1)

      act(() => {
        list().props.onScroll(scrolledTo(700, 1_200))
        list().props.onContentSizeChange(320, 1_400)
      })
      expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 1_400 })
    })

    it('does not take its own pin, landing short of a grown end, for the reader', async () => {
      await render({ folded: [assistantTurn('a1', 'Latest')] })
      act(() => {
        list().props.onContentSizeChange(320, 1_000)
        list().props.onScroll(scrolledTo(500, 1_000))
      })
      scrollToOffset.mockClear()

      // The pin reached the end it was sent to; the reply had grown 400 past it by then.
      act(() => {
        list().props.onScroll(scrolledTo(700, 1_600))
        list().props.onContentSizeChange(320, 1_600)
      })

      expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 1_600 })
    })

    it('pins a resized viewport to the measured end, never the list estimate', async () => {
      await render({ folded: [assistantTurn('a1', 'Latest')] })
      act(() => list().props.onContentSizeChange(320, 1_000))
      scrollToEnd.mockClear()

      act(() => list().props.onLayout?.({}))

      expect(scrollToEnd).not.toHaveBeenCalled()
      expect(scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 1_000 })
    })

    it('pages in history when the reader scrolls up to the top, not when a pin passes it', async () => {
      const onLoadEarlier = vi.fn()
      await render({ folded: [assistantTurn('a1', 'Latest')], hasMore: true, onLoadEarlier })

      act(() => list().props.onScroll(scrolledTo(40, 540)))
      expect(onLoadEarlier).not.toHaveBeenCalled()

      act(() => list().props.onScroll(scrolledTo(10, 540)))
      expect(onLoadEarlier).toHaveBeenCalledOnce()
    })
  })
})

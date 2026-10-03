import { useEffect, useState } from 'react'
import { currentSoftKeyboardHeight, subscribeSoftKeyboard } from '../platform/keyboard-occlusion'

export function useMobileSearchKeyboardInset(enabled: boolean): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!enabled) {
      return
    }
    // Expo's edge-to-edge window stays full height while the search keyboard is open.
    setHeight(Math.max(0, currentSoftKeyboardHeight()))
    return subscribeSoftKeyboard(
      (height) => setHeight(Math.max(0, height)),
      () => setHeight(0)
    )
  }, [enabled])
  return enabled ? height : 0
}

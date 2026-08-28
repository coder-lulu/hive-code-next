import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated'
import { useReducedMotionEnabled } from '../hooks/use-reduced-motion-enabled'
import type { MobileHomeMode } from './mobile-home-mode'

const MODE_SWITCH_DURATION_MS = 240
const MODE_SWITCH_OFFSET = 28

type Props = {
  readonly mode: MobileHomeMode
  readonly renderMode: (mode: MobileHomeMode) => ReactNode
}

/** Keeps both home surfaces mounted while the selected mode crosses the canvas. */
export function MobileHomeModeTransition({ mode, renderMode }: Props) {
  const reducedMotionEnabled = useReducedMotionEnabled()
  const progress = useSharedValue(1)
  const currentModeRef = useRef(mode)
  const [displayedMode, setDisplayedMode] = useState(mode)
  const [transitionFrom, setTransitionFrom] = useState<MobileHomeMode | null>(null)

  useEffect(() => {
    if (mode === currentModeRef.current) {
      return
    }

    const from = currentModeRef.current
    currentModeRef.current = mode
    cancelAnimation(progress)
    setDisplayedMode(mode)

    if (reducedMotionEnabled) {
      progress.value = 1
      setTransitionFrom(null)
      return
    }

    setTransitionFrom(from)
    progress.value = 0
    progress.value = withTiming(
      1,
      {
        duration: MODE_SWITCH_DURATION_MS,
        easing: Easing.out(Easing.cubic)
      },
      (finished) => {
        if (finished) {
          runOnJS(setTransitionFrom)(null)
        }
      }
    )
  }, [mode, progress, reducedMotionEnabled])

  const direction =
    transitionFrom === 'cloud' && displayedMode === 'computer'
      ? -1
      : transitionFrom === 'computer' && displayedMode === 'cloud'
        ? 1
        : 0
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [0, direction * MODE_SWITCH_OFFSET],
          Extrapolation.CLAMP
        )
      }
    ]
  }))
  const incomingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [-direction * MODE_SWITCH_OFFSET, 0],
          Extrapolation.CLAMP
        )
      }
    ]
  }))

  if (!transitionFrom) {
    return <View style={styles.container}>{renderMode(displayedMode)}</View>
  }

  return (
    <View style={styles.container}>
      <Animated.View pointerEvents="none" style={[styles.layer, outgoingStyle]}>
        {renderMode(transitionFrom)}
      </Animated.View>
      <Animated.View style={[styles.layer, incomingStyle]}>
        {renderMode(displayedMode)}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  layer: { ...StyleSheet.absoluteFillObject }
})

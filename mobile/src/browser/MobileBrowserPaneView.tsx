import { useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  type PanResponderInstance,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileBrowserAddressField } from './MobileBrowserAddressField'
import { MobileBrowserKeyRow } from './MobileBrowserKeyRow'
import {
  MobileBrowserPointerModifiers,
  type BrowserPointerModifier
} from './MobileBrowserPointerModifiers'
import { MobileBrowserToolbarIconButton } from './MobileBrowserToolbarIconButton'
import { MobileBrowserViewModeSwitch } from './MobileBrowserViewModeSwitch'
import { createMobileBrowserPaneStyles } from './mobile-browser-pane-styles'
import type { BrowserFrameLayerBinding } from './browser-frame-pacer'
import type {
  BrowserFrameGeometry,
  BrowserTouchLayout,
  BrowserZoomState
} from './browser-touch-geometry'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import type { MobileBrowserTab } from './MobileBrowserPane'
import type { BrowserDialogState } from './mobile-browser-stream-events'

type MobileBrowserPaneViewProps = {
  addressFocused: boolean
  addressValue: string
  bottomInset: number
  browserViewMode: MobileBrowserViewMode
  busy: boolean
  controlsDisabled: boolean
  dialog: BrowserDialogState | null
  error: string | null
  frameGeometry: BrowserFrameGeometry | null
  frameLayers: readonly [BrowserFrameLayerBinding, BrowserFrameLayerBinding]
  goBack: () => void
  goForward: () => void
  keyboardLift: number
  keyboardValue: string
  layoutRef: RefObject<BrowserTouchLayout | null>
  navigateToAddress: () => Promise<void>
  panResponder: PanResponderInstance
  pointerModifiers: BrowserPointerModifier[]
  reloadPage: () => void
  renderedFrameSource: { uri: string } | null
  selectBrowserViewMode: (mode: MobileBrowserViewMode) => void
  sendDialogCommand: (method: 'browser.dialogDismiss' | 'browser.dialogAccept') => Promise<void>
  sendKeyboardText: () => Promise<void>
  sendKeypress: (key: string) => Promise<void>
  setAddressFocused: Dispatch<SetStateAction<boolean>>
  setAddressValue: Dispatch<SetStateAction<string>>
  setKeyboardValue: Dispatch<SetStateAction<string>>
  setLayout: Dispatch<SetStateAction<BrowserTouchLayout | null>>
  setRootViewRef: (view: View | null) => void
  tab: MobileBrowserTab
  togglePointerModifier: (modifier: BrowserPointerModifier) => void
  zoom: BrowserZoomState
}

/**
 * The pane's chrome and the surface the frames paint into.
 *
 * "Never dark" holds only for a page that produces some frame that fits: with every frame over the
 * cap this sits on its busy spinner over an unpainted viewport, which the C6.6 device proof
 * measured with the area budget forced off — 299 dropped, 6 applied, the stream alive and no error
 * state, and nothing to look at. That is C6 ruling 1 working as written, not a failure of it: a
 * frame that does not fit is dropped rather than ending the stream. It is what the area budget
 * exists to keep from happening.
 */
export function MobileBrowserPaneView(props: MobileBrowserPaneViewProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileBrowserPaneStyles)
  // The pacer changes opacity imperatively after mount. Keep style props stable across stream renders.
  const frameLayerStyles = useMemo<[StyleProp<ViewStyle>, StyleProp<ViewStyle>]>(
    () => [
      styles.browserImageLayer,
      [styles.browserImageLayer, styles.browserImageLayerHidden]
    ],
    [styles]
  )
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const {
    addressFocused,
    addressValue,
    bottomInset,
    browserViewMode,
    busy,
    controlsDisabled,
    dialog,
    error,
    frameGeometry,
    frameLayers,
    goBack,
    goForward,
    keyboardLift,
    keyboardValue,
    layoutRef,
    navigateToAddress,
    panResponder,
    pointerModifiers,
    reloadPage,
    renderedFrameSource,
    selectBrowserViewMode,
    sendDialogCommand,
    sendKeyboardText,
    sendKeypress,
    setAddressFocused,
    setAddressValue,
    setKeyboardValue,
    setLayout,
    setRootViewRef,
    tab,
    togglePointerModifier,
    zoom
  } = props
  return (
    <View ref={setRootViewRef} style={styles.root}>
      <View style={styles.toolbar}>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoBack}
          label="Back"
          onPress={goBack}
        >
          <ChevronLeft
            size={20}
            strokeWidth={2}
            color={browserControlColor(theme, !controlsDisabled && tab.canGoBack)}
          />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoForward}
          label="Forward"
          onPress={goForward}
        >
          <ChevronRight
            size={20}
            strokeWidth={2}
            color={browserControlColor(theme, !controlsDisabled && tab.canGoForward)}
          />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled}
          label="Reload"
          onPress={reloadPage}
        >
          <RefreshCw
            size={20}
            strokeWidth={2}
            color={browserControlColor(theme, !controlsDisabled)}
          />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserAddressField
          value={addressValue}
          onChangeText={setAddressValue}
          onFocus={() => setAddressFocused(true)}
          onBlur={() => setAddressFocused(false)}
          onSubmit={() => void navigateToAddress()}
          focused={addressFocused}
          disabled={controlsDisabled}
        />
        <MobileBrowserViewModeSwitch
          disabled={controlsDisabled}
          value={browserViewMode}
          onChange={selectBrowserViewMode}
        />
      </View>

      <View
        style={styles.viewport}
        onLayout={(event) => {
          const next = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height
          }
          const current = layoutRef.current
          if (current && current.width === next.width && current.height === next.height) {
            return
          }
          layoutRef.current = next
          setLayout(next)
        }}
        {...panResponder.panHandlers}
      >
        {renderedFrameSource ? (
          <View style={styles.browserImageHost}>
            {frameGeometry ? (
              <View
                pointerEvents="none"
                style={[
                  styles.browserZoomOffset,
                  {
                    width: frameGeometry.renderedWidth,
                    height: frameGeometry.renderedHeight,
                    transform: [{ translateX: zoom.offsetX }, { translateY: zoom.offsetY }]
                  }
                ]}
              >
                <View
                  style={[
                    styles.browserFrameBox,
                    {
                      width: frameGeometry.renderedWidth,
                      height: frameGeometry.renderedHeight,
                      transform: [{ scale: zoom.scale }]
                    }
                  ]}
                >
                  {([0, 1] as const).map((layer) => (
                    <View
                      key={layer}
                      ref={frameLayers[layer].attachView}
                      pointerEvents="none"
                      style={frameLayerStyles[layer]}
                    >
                      <Image
                        ref={frameLayers[layer].attachImage}
                        source={renderedFrameSource}
                        resizeMode="stretch"
                        fadeDuration={0}
                        onLoad={frameLayers[layer].onLoad}
                        onError={frameLayers[layer].onError}
                        style={[
                          styles.browserImage,
                          {
                            width: frameGeometry.renderedWidth,
                            height: frameGeometry.renderedHeight
                          }
                        ]}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              ([0, 1] as const).map((layer) => (
                <View
                  key={layer}
                  ref={frameLayers[layer].attachView}
                  pointerEvents="none"
                  style={frameLayerStyles[layer]}
                >
                  <Image
                    ref={frameLayers[layer].attachImage}
                    source={renderedFrameSource}
                    resizeMode="contain"
                    fadeDuration={0}
                    onLoad={frameLayers[layer].onLoad}
                    onError={frameLayers[layer].onError}
                    style={styles.browserImageFill}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
        {!renderedFrameSource || busy || error ? (
          <View
            pointerEvents="none"
            style={[styles.overlay, !renderedFrameSource && styles.emptyOverlay]}
          >
            {/* Why: a stream can report ready and then deliver no frames, so key the
                indicator off actually having pixels or it clears into a blank pane. */}
            {busy || (!renderedFrameSource && !error) ? (
              <View style={styles.loadingIndicatorHost}>
                <ActivityIndicator size="small" color={theme.color.text.secondary} />
              </View>
            ) : null}
            {error ? (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                maxFontSizeMultiplier={1.3}
              >
                {error}
              </Text>
            ) : null}
          </View>
        ) : null}
        {dialog ? (
          <View style={styles.dialogOverlay} accessibilityViewIsModal>
            <View style={styles.dialogCard} accessibilityRole="alert">
              <Text style={styles.dialogTitle} maxFontSizeMultiplier={1.3}>
                Browser Dialog
              </Text>
              <Text style={styles.dialogMessage} maxFontSizeMultiplier={1.3}>
                {dialog.message}
              </Text>
              {dialog.error ? (
                <Text style={styles.dialogError} maxFontSizeMultiplier={1.3}>
                  {dialog.error}
                </Text>
              ) : null}
              <View style={styles.dialogActions}>
                {dialog.dialogType !== 'alert' ? (
                  <Pressable
                    disabled={dialog.pending !== undefined}
                    style={({ pressed }) => [
                      styles.dialogButton,
                      pressed && styles.dialogButtonPressed,
                      dialog.pending !== undefined && styles.disabled
                    ]}
                    onPress={() => void sendDialogCommand('browser.dialogDismiss')}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel browser dialog"
                  >
                    <Text style={styles.dialogButtonText} maxFontSizeMultiplier={1.3}>
                      Cancel
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  disabled={dialog.pending !== undefined}
                  style={({ pressed }) => [
                    styles.dialogButton,
                    styles.dialogButtonPrimary,
                    pressed && styles.dialogButtonPressed,
                    dialog.pending !== undefined && styles.disabled
                  ]}
                  onPress={() => void sendDialogCommand('browser.dialogAccept')}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm browser dialog"
                >
                  <Text
                    style={[styles.dialogButtonText, styles.dialogButtonPrimaryText]}
                    maxFontSizeMultiplier={1.3}
                  >
                    OK
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.keyboardDock,
          { paddingBottom: bottomInset, transform: [{ translateY: -keyboardLift }] }
        ]}
      >
        <MobileBrowserPointerModifiers
          disabled={controlsDisabled}
          selectedModifiers={pointerModifiers}
          onToggle={togglePointerModifier}
        />
        <MobileBrowserKeyRow
          disabled={controlsDisabled}
          onKeypress={(key) => void sendKeypress(key)}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.keyboardInput, keyboardFocused && styles.keyboardInputFocused]}
            value={keyboardValue}
            onChangeText={setKeyboardValue}
            placeholder="Type on page…"
            placeholderTextColor={theme.color.text.tertiary}
            selectionColor={theme.color.brand.primary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!controlsDisabled}
            onFocus={() => setKeyboardFocused(true)}
            onBlur={() => setKeyboardFocused(false)}
            onSubmitEditing={() => void sendKeyboardText()}
            accessibilityLabel="Text to type in browser"
            accessibilityState={{ disabled: controlsDisabled }}
            maxFontSizeMultiplier={1.3}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendButton,
              !controlsDisabled && !!keyboardValue && styles.sendButtonEnabled,
              pressed && !controlsDisabled && !!keyboardValue && styles.sendButtonPressed,
              (controlsDisabled || !keyboardValue) && styles.disabled
            ]}
            disabled={controlsDisabled || !keyboardValue}
            onPress={() => void sendKeyboardText()}
            accessibilityRole="button"
            accessibilityLabel="Send text to browser"
            accessibilityState={{ disabled: controlsDisabled || !keyboardValue }}
          >
            <ArrowUp
              size={20}
              strokeWidth={2}
              color={
                !controlsDisabled && keyboardValue
                  ? theme.color.text.inverse
                  : theme.color.text.tertiary
              }
            />
          </Pressable>
        </View>
      </View>
    </View>
  )
}

function browserControlColor(theme: MobileTheme, enabled: boolean): string {
  return enabled ? theme.color.text.secondary : theme.color.text.tertiary
}

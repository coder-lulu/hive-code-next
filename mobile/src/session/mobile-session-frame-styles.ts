import { StyleSheet } from 'react-native'

import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileSessionFrameStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    kavInner: {
      flex: 1
    },
    sessionContentRow: {
      flex: 1,
      flexDirection: 'row'
    },
    sessionContentMain: {
      flex: 1,
      minWidth: 0,
      backgroundColor: theme.color.bg.canvas
    },
    sessionChrome: {
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    sessionTopBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space8
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space4
    },
    backButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    filesButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: theme.spacing.space4
    },
    filesButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    filesButtonActive: {
      backgroundColor: theme.color.bg.selected
    },
    sessionTitleBlock: {
      flex: 1,
      minWidth: 0
    },
    sessionTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    sessionMetaRow: {
      gap: theme.spacing.space8,
      minHeight: theme.spacing.space20,
      flexDirection: 'row',
      alignItems: 'center'
    },
    sessionMetaText: {
      ...theme.typography.caption,
      flexShrink: 1,
      color: theme.color.text.secondary
    },
    tabBar: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    tabScroll: {
      flex: 1,
      maxHeight: theme.size.minimumTouchTarget
    },
    tabContent: {
      paddingHorizontal: theme.spacing.space8
    },
    tab: {
      width: 128,
      maxWidth: 128,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space8,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent'
    },
    tabActive: {
      borderBottomColor: theme.color.text.primary
    },
    tabLabelRow: {
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    tabText: {
      ...theme.typography.meta,
      flexShrink: 1,
      color: theme.color.text.secondary
    },
    tabTextActive: {
      color: theme.color.text.primary,
      fontWeight: '500'
    },
    newTerminalButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    newTerminalButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    newTerminalButtonDisabled: {
      opacity: 0.45
    },
    tabActionDivider: {
      width: StyleSheet.hairlineWidth,
      height: theme.spacing.space20,
      backgroundColor: theme.color.border.subtle
    },
    contentFrame: { flex: 1, minHeight: 0 },
    terminalFrame: {
      flex: 1,
      minHeight: 0,
      position: 'relative',
      overflow: 'hidden'
    },
    terminalPane: {
      ...StyleSheet.absoluteFillObject
    },
    terminalPaneHidden: {
      opacity: 0
    },
    terminalWebView: {
      flex: 1
    },
    markdownFrame: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.color.bg.canvas
    },
    browserFrame: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.color.bg.canvas
    }
  })
}

import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createCustomKeyModalStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: theme.spacing.space8
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    backButtonPressed: { backgroundColor: theme.color.bg.subtle },
    backSpacer: { width: theme.size.minimumTouchTarget },
    title: {
      ...theme.typography.sectionTitle,
      flex: 1,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    group: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    rowPressed: { backgroundColor: theme.color.bg.subtle },
    rowLabel: {
      ...theme.typography.label,
      marginBottom: theme.spacing.space4,
      color: theme.color.text.primary
    },
    rowHint: { ...theme.typography.caption, color: theme.color.text.secondary },
    shortcutForm: { paddingTop: theme.spacing.space8 },
    preview: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space20
    },
    previewKeycapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    previewPlus: { ...theme.typography.sectionTitle, color: theme.color.text.tertiary },
    keycap: {
      minWidth: theme.spacing.space48,
      height: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    keycapModifier: { minWidth: 0 },
    keycapWarn: { borderColor: theme.color.status.warning },
    keycapText: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontSize: 17,
      fontWeight: '600'
    },
    keycapTextWarn: { color: theme.color.status.warning },
    keycapModifierText: {
      ...theme.typography.code,
      color: theme.color.text.secondary,
      fontSize: 14,
      fontWeight: '600'
    },
    section: { marginTop: theme.spacing.space12 },
    sectionLabel: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space8,
      paddingLeft: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    mods: { flexDirection: 'row', gap: theme.spacing.space8 },
    chip: {
      minHeight: theme.size.minimumTouchTarget,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    chipSelected: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    chipPressed: { backgroundColor: theme.color.bg.subtle },
    chipText: { ...theme.typography.label, color: theme.color.text.secondary },
    chipTextSelected: { color: theme.color.text.inverse },
    chipGlyph: { ...theme.typography.code, color: theme.color.text.tertiary },
    chipGlyphSelected: { color: theme.color.text.inverse, opacity: 0.55 },
    keyInput: {
      width: '100%',
      height: 56,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      fontFamily: theme.typography.code.fontFamily,
      fontSize: 22,
      fontWeight: '600',
      textAlign: 'center'
    },
    moreLink: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space8
    },
    moreLinkPressed: { opacity: 0.6 },
    moreLinkText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textDecorationLine: 'underline'
    },
    specialKeysForm: {
      gap: theme.spacing.space12,
      paddingTop: theme.spacing.space4,
      paddingBottom: theme.spacing.space12
    },
    specialGroup: { gap: theme.spacing.space4 },
    specialGroupTitle: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space4,
      paddingLeft: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    keyGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -theme.spacing.space4 / 2
    },
    keyCellWrap: {
      paddingHorizontal: theme.spacing.space4 / 2,
      paddingVertical: theme.spacing.space4 / 2
    },
    keyCell: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    keyCellPressed: { backgroundColor: theme.color.bg.subtle },
    keyCellSelected: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    keyCellText: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    keyCellTextSelected: { color: theme.color.text.inverse },
    macroForm: { gap: theme.spacing.space8, padding: theme.spacing.space16 },
    fieldLabel: { ...theme.typography.label, color: theme.color.text.secondary },
    fieldInput: {
      minHeight: theme.spacing.space48,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.canvas,
      color: theme.color.text.primary,
      fontFamily: theme.typography.code.fontFamily,
      fontSize: theme.typography.label.fontSize
    },
    switchRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.space4
    },
    switchLabel: { ...theme.typography.label, color: theme.color.text.primary },
    saveButton: {
      minHeight: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    saveButtonDisabled: { backgroundColor: theme.color.bg.subtle },
    saveButtonText: { ...theme.typography.label, color: theme.color.text.inverse },
    saveButtonTextDisabled: { color: theme.color.text.tertiary }
  })
}

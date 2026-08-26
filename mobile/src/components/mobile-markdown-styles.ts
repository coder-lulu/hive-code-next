import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileMarkdownStyles(theme: MobileTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.space8
    },
    paragraph: {
      ...theme.typography.meta,
      color: theme.color.text.primary
    },
    heading: {
      ...theme.typography.label,
      fontWeight: '600',
      color: theme.color.text.primary
    },
    headingLarge: {
      ...theme.typography.body,
      fontWeight: '600'
    },
    bold: {
      fontWeight: '600',
      color: theme.color.text.primary
    },
    italic: {
      fontStyle: 'italic'
    },
    strike: {
      textDecorationLine: 'line-through'
    },
    link: {
      color: theme.color.brand.primary,
      textDecorationLine: 'underline'
    },
    inlineCode: {
      ...theme.typography.caption,
      fontFamily: theme.typography.code.fontFamily,
      color: theme.color.text.primary,
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.small,
      paddingHorizontal: theme.spacing.space4
    },
    inlineCodeLink: {
      color: theme.color.brand.primary,
      textDecorationLine: 'underline'
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.color.border.default,
      paddingLeft: theme.spacing.space8
    },
    quoteText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    codeBlock: {
      backgroundColor: theme.color.bg.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      padding: theme.spacing.space8
    },
    codeLanguage: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginBottom: theme.spacing.space4,
      textTransform: 'uppercase'
    },
    codeText: {
      ...theme.typography.code,
      color: theme.color.text.primary
    },
    imageFrame: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      overflow: 'hidden',
      padding: theme.spacing.space8
    },
    imageCaption: {
      ...theme.typography.caption,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    table: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      overflow: 'hidden',
      backgroundColor: theme.color.bg.surface
    },
    tableRow: {
      flexDirection: 'row'
    },
    tableCell: {
      ...theme.typography.caption,
      minWidth: 112,
      maxWidth: 220,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      color: theme.color.text.primary
    },
    tableHeader: {
      fontWeight: '600',
      backgroundColor: theme.color.bg.subtle
    },
    tableTruncated: {
      ...theme.typography.caption,
      padding: theme.spacing.space8,
      color: theme.color.text.tertiary
    },
    list: {
      gap: theme.spacing.space4
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space8
    },
    listMarker: {
      ...theme.typography.meta,
      width: 22,
      color: theme.color.text.secondary,
      fontFamily: theme.typography.code.fontFamily
    },
    listText: {
      ...theme.typography.meta,
      flex: 1,
      minWidth: 0,
      color: theme.color.text.primary
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle
    }
  })
}

export type MobileMarkdownStyles = ReturnType<typeof createMobileMarkdownStyles>

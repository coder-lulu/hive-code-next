import type { MobileTheme } from '../../theme/mobile-theme'

/**
 * The one mermaid configuration both hosts run.
 *
 * The native document splices it into the inline script it builds; the page hands the same object
 * to `mermaid.initialize`. Written down twice these would drift, and the drift would be a diagram
 * that looks different on the page from the one on the phone.
 *
 * `suppressErrorRendering` because a diagram that throws is a source box on both hosts: without it
 * mermaid draws its own error diagram into a temporary element and then leaves that element in the
 * document as it rethrows, which on the page is an orphan SVG under nobody's mount.
 */
export const MERMAID_DIAGRAM_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true
} as const

export function mermaidDiagramConfig(theme: MobileTheme) {
  return {
    ...MERMAID_DIAGRAM_CONFIG,
    theme: theme.scheme === 'dark' ? ('dark' as const) : ('neutral' as const),
    darkMode: theme.scheme === 'dark',
    themeVariables: {
      background: theme.color.bg.subtle,
      primaryColor: theme.color.bg.surface,
      primaryTextColor: theme.color.text.primary,
      lineColor: theme.color.text.secondary,
      textColor: theme.color.text.primary
    }
  }
}

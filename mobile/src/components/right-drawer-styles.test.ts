import { describe, expect, it, vi } from 'vitest'
import { mobileThemes } from '../theme/mobile-theme'
import { createRightDrawerStyles } from './right-drawer-styles'

vi.mock('react-native', () => ({
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', inset: 0 },
    create: <T>(styles: T) => styles,
    hairlineWidth: 1
  }
}))

describe('Graphite right drawer styles', () => {
  it.each(['light', 'dark'] as const)('uses %s semantic surfaces and overlay tokens', (scheme) => {
    const theme = mobileThemes[scheme]
    const styles = createRightDrawerStyles(theme)

    expect(styles.backdrop.backgroundColor).toBe(theme.color.overlay)
    expect(styles.drawer).toMatchObject({
      backgroundColor: theme.color.bg.surface,
      borderLeftColor: theme.color.border.default,
      borderTopLeftRadius: theme.radii.overlay,
      borderBottomLeftRadius: theme.radii.overlay,
      paddingLeft: theme.spacing.space12
    })
  })
})

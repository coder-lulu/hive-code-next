export const lightThemeColors = {
  bg: {
    canvas: '#F5F6F7',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    subtle: '#ECEEF1',
    selected: '#17191D'
  },
  text: {
    primary: '#17191D',
    secondary: '#656C77',
    tertiary: '#939AA5',
    inverse: '#FFFFFF'
  },
  border: {
    default: '#DDE1E6',
    subtle: '#E9EBEF'
  },
  brand: {
    primary: '#2F6BFF',
    subtle: '#EEF3FF'
  },
  status: {
    success: '#18A979',
    warning: '#C88719',
    danger: '#E5484D'
  },
  overlay: 'rgba(13,15,18,0.36)'
} as const

export const darkThemeColors = {
  bg: {
    canvas: '#0D0F12',
    surface: '#171A1F',
    elevated: '#1E2228',
    subtle: '#242830',
    selected: '#F5F6F8'
  },
  text: {
    primary: '#F5F6F8',
    secondary: '#A3AAB5',
    tertiary: '#6F7783',
    inverse: '#17191D'
  },
  border: {
    default: '#30353D',
    subtle: '#262B32'
  },
  brand: {
    primary: '#5B8CFF',
    subtle: '#17233D'
  },
  status: {
    success: '#35C998',
    warning: '#E1A53A',
    danger: '#FF6369'
  },
  overlay: 'rgba(0,0,0,0.56)'
} as const

export const lightTerminalColors = {
  background: lightThemeColors.bg.canvas,
  foreground: lightThemeColors.text.primary,
  cursor: lightThemeColors.text.primary,
  cursorAccent: lightThemeColors.bg.canvas,
  selectionBackground: lightThemeColors.border.default,
  selectionForeground: lightThemeColors.text.primary,
  black: '#17191D',
  red: '#B4232C',
  green: '#147A58',
  yellow: '#8A5A12',
  blue: '#2457CC',
  magenta: '#783FA1',
  cyan: '#166A78',
  white: '#F5F6F7',
  brightBlack: '#656C77',
  brightRed: '#C9343C',
  brightGreen: '#168B65',
  brightYellow: '#9B6817',
  brightBlue: '#2F6BFF',
  brightMagenta: '#9251C7',
  brightCyan: '#197C8C',
  brightWhite: '#FFFFFF'
} as const

export const darkTerminalColors = {
  background: '#1A1B26',
  foreground: '#C0CAF5',
  cursor: '#C0CAF5',
  cursorAccent: '#1A1B26',
  selectionBackground: '#33467C',
  selectionForeground: '#C0CAF5',
  black: '#15161E',
  red: '#F7768E',
  green: '#9ECE6A',
  yellow: '#E0AF68',
  blue: '#7AA2F7',
  magenta: '#BB9AF7',
  cyan: '#7DCFFF',
  white: '#A9B1D6',
  brightBlack: '#414868',
  brightRed: '#F7768E',
  brightGreen: '#9ECE6A',
  brightYellow: '#E0AF68',
  brightBlue: '#7AA2F7',
  brightMagenta: '#BB9AF7',
  brightCyan: '#7DCFFF',
  brightWhite: '#C0CAF5'
} as const

export const spacingTokens = {
  space4: 4,
  space8: 8,
  space12: 12,
  space16: 16,
  space20: 20,
  space24: 24,
  space32: 32,
  space40: 40,
  space48: 48,
  space64: 64
} as const

export const radiusTokens = {
  small: 4,
  control: 8,
  card: 12,
  overlay: 16,
  // React Native needs a numeric radius; equal width and height make this circular.
  circle: 9999
} as const

export const componentSizeTokens = {
  minimumTouchTarget: 44,
  navigationBarHeight: 56,
  groupedListRowMinHeight: 56,
  overlayMaxWidth: 400
} as const

export const typographyTokens = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '600' },
  pageTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  sectionTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  code: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '400',
    fontFamily: 'monospace'
  }
} as const

export const lightTheme = {
  scheme: 'light',
  color: lightThemeColors,
  terminal: lightTerminalColors,
  spacing: spacingTokens,
  radii: radiusTokens,
  size: componentSizeTokens,
  typography: typographyTokens
} as const

export const darkTheme = {
  scheme: 'dark',
  color: darkThemeColors,
  terminal: darkTerminalColors,
  spacing: spacingTokens,
  radii: radiusTokens,
  size: componentSizeTokens,
  typography: typographyTokens
} as const

export const mobileThemes = {
  light: lightTheme,
  dark: darkTheme
} as const

export type MobileTheme = (typeof mobileThemes)[keyof typeof mobileThemes]
export type MobileThemeScheme = keyof typeof mobileThemes

// Compatibility exports keep existing screens stable while they migrate to semantic themes.
export const colors = {
  bgBase: '#111111',
  bgPanel: '#1a1a1a',
  bgRaised: '#242424',
  borderSubtle: '#2a2a2a',
  editorSurface: '#1e1e1e',
  textPrimary: '#e0e0e0',
  textSecondary: '#a1a1a1',
  textMuted: '#8c8c8c',
  surfaceBright: '#f5f5f5',
  accentBlue: '#3b82f6',
  onAccent: '#ffffff',
  statusGreen: '#22c55e',
  statusAmber: '#f59e0b',
  statusRed: '#ef4444',
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  statusPurple: '#a78bfa',
  gitDecorationAdded: '#81b88b',
  gitDecorationDeleted: '#c74e39',
  diffAddedBg: 'rgba(129, 184, 139, 0.1)',
  diffDeletedBg: 'rgba(199, 78, 57, 0.11)',
  syntaxComment: '#6a9955',
  syntaxKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxType: '#4ec9b0',
  syntaxFunction: '#dcdcaa',
  syntaxVariable: '#9cdcfe',
  syntaxMeta: '#c586c0',
  terminalBg: '#1a1b26'
} as const

export const spacing = {
  xs: spacingTokens.space4,
  sm: spacingTokens.space8,
  md: spacingTokens.space12,
  lg: spacingTokens.space16,
  xl: spacingTokens.space24
} as const

export const radii = {
  row: radiusTokens.control,
  card: radiusTokens.card,
  button: radiusTokens.control,
  input: radiusTokens.control,
  camera: radiusTokens.control
} as const

export const typography = {
  titleSize: typographyTokens.pageTitle.fontSize,
  bodySize: typographyTokens.label.fontSize,
  metaSize: typographyTokens.caption.fontSize,
  monoFamily: typographyTokens.code.fontFamily
} as const

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
    successText: '#147A58',
    warning: '#C88719',
    warningText: '#8A5A12',
    warningSubtle: '#FFF4E2',
    danger: '#E5484D',
    dangerText: '#B4232C'
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
    successText: '#35C998',
    warning: '#E1A53A',
    warningText: '#E1A53A',
    warningSubtle: '#322714',
    danger: '#FF6369',
    dangerText: '#FF6369'
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
  iconSmall: 16,
  iconStrokeWidth: 2,
  minimumTouchTarget: 44,
  navigationBarHeight: 56,
  compactLayoutBreakpoint: 380,
  activeIndicatorHeight: 2,
  floatingActionButtonSize: 48,
  groupedListRowMinHeight: 56,
  actionSheetHeightRatio: 0.6,
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

export const motionTokens = { standardDurationMs: 200 } as const

export const lightTheme = {
  scheme: 'light',
  motion: motionTokens,
  color: lightThemeColors,
  terminal: lightTerminalColors,
  spacing: spacingTokens,
  radii: radiusTokens,
  size: componentSizeTokens,
  typography: typographyTokens
} as const

export const darkTheme = {
  scheme: 'dark',
  motion: motionTokens,
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

// Desktop's main.css tokens per scheme; keep mobile on these instead of introducing inline colors.

export type MobileColorScheme = 'light' | 'dark'

const darkColors = {
  // --background, --sidebar, --secondary, --border
  bgBase: '#0a0a0a',
  bgPanel: '#171717',
  bgRaised: '#262626',
  borderSubtle: 'rgba(255, 255, 255, 0.07)',
  editorSurface: '#1e1e1e',
  // --chat-composer-surface painted over --chat-canvas, and --chat-composer-border.
  composerSurface: '#1f1f1f',
  composerBorder: 'rgba(250, 250, 250, 0.09)',
  composerControl: '#262626',
  skillToken: '#8ab4f8',
  skillTokenSurface: 'rgba(59, 130, 246, 0.2)',
  // Your own message: --chat-user-surface and --chat-user-border over --chat-canvas, text in --chat-foreground-strong.
  chatUserSurface: '#262626',
  chatUserBorder: 'rgba(250, 250, 250, 0.06)',
  chatForegroundStrong: '#e3e3e3',

  // --foreground, --muted-foreground, --chat-foreground-faint
  textPrimary: '#fafafa',
  textSecondary: '#a1a1a1',
  textMuted: '#898989',

  // --primary: the filled primary-action surface.
  surfaceBright: '#e5e5e5',

  accentBlue: '#3b82f6',
  // White text preserves contrast on saturated accent fills.
  onAccent: '#ffffff',

  // --status-success, --status-warning, --destructive
  statusGreen: '#86efac',
  statusAmber: '#eab308',
  statusRed: '#ff6568',
  // Match desktop’s merge CTA fill and text.
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  // Desktop's merged-PR purple (`dark:text-purple-300`).
  statusPurple: '#d8b4fe',
  gitDecorationAdded: '#81b88b',
  gitDecorationDeleted: '#c74e39',
  // Desktop's `--diff-*-ground` and `--diff-*-gutter` mixes.
  diffAddedBg: 'rgba(129, 184, 139, 0.16)',
  diffDeletedBg: 'rgba(199, 78, 57, 0.18)',
  diffAddedGutter: 'rgba(129, 184, 139, 0.3)',
  diffDeletedGutter: 'rgba(199, 78, 57, 0.32)',
  // Desktop's `--chat-diff-*`: decoration mixed toward foreground for tinted rows.
  chatDiffAdded: '#a5ccac',
  chatDiffRemoved: '#d68273',

  // Monaco's `vs-dark`; function and meta come from VS Code Dark+, which Monaco lacks.
  syntaxComment: '#608b4e',
  syntaxKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxType: '#3dc9b0',
  syntaxFunction: '#dcdcaa',
  syntaxVariable: '#74b0df',
  syntaxMeta: '#c586c0',

  // Terminal WebView background (Tokyonight) — separate from app chrome
  terminalBg: '#1a1b26'
}

export type MobilePalette = { readonly [K in keyof typeof darkColors]: string }

const lightColors: MobilePalette = {
  bgBase: '#ffffff',
  bgPanel: '#fafafa',
  bgRaised: '#f5f5f5',
  borderSubtle: '#e5e5e5',
  editorSurface: '#ffffff',
  composerSurface: '#ffffff',
  composerBorder: 'rgba(10, 10, 10, 0.11)',
  composerControl: '#f5f5f5',
  skillToken: '#1d4ed8',
  skillTokenSurface: 'rgba(59, 130, 246, 0.12)',
  chatUserSurface: '#f5f5f5',
  chatUserBorder: 'rgba(10, 10, 10, 0.07)',
  chatForegroundStrong: '#1e1e1e',

  textPrimary: '#0a0a0a',
  textSecondary: '#737373',
  textMuted: '#737373',

  surfaceBright: '#171717',

  accentBlue: '#2563eb',
  onAccent: '#ffffff',

  statusGreen: '#15803d',
  statusAmber: '#ca8a04',
  statusRed: '#e40014',
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  statusPurple: '#9333ea',
  gitDecorationAdded: '#587c0c',
  gitDecorationDeleted: '#ad0707',
  diffAddedBg: 'rgba(88, 124, 12, 0.13)',
  diffDeletedBg: 'rgba(173, 7, 7, 0.11)',
  diffAddedGutter: 'rgba(88, 124, 12, 0.26)',
  diffDeletedGutter: 'rgba(173, 7, 7, 0.22)',
  chatDiffAdded: '#415a0b',
  chatDiffRemoved: '#7c0808',

  // Monaco's `vs`; function and meta from VS Code Light+.
  syntaxComment: '#008000',
  syntaxKeyword: '#0000ff',
  syntaxString: '#a31515',
  syntaxNumber: '#098658',
  syntaxType: '#008080',
  syntaxFunction: '#795e26',
  syntaxVariable: '#001188',
  syntaxMeta: '#af00db',

  terminalBg: '#1a1b26'
}

const palettes: Record<MobileColorScheme, MobilePalette> = { dark: darkColors, light: lightColors }

export function paletteForScheme(scheme: MobileColorScheme): MobilePalette {
  return palettes[scheme]
}

// Live object rewritten in place on a scheme change; read it at render time, never copy at module scope.
export const colors: MobilePalette = { ...darkColors }

let currentScheme: MobileColorScheme = 'dark'
const schemeListeners = new Set<() => void>()

export function getMobileColorScheme(): MobileColorScheme {
  return currentScheme
}

export function applyMobileColorScheme(scheme: MobileColorScheme): void {
  if (scheme === currentScheme) {
    return
  }
  currentScheme = scheme
  Object.assign(colors, palettes[scheme])
  for (const listener of schemeListeners) {
    listener()
  }
}

export function subscribeMobileColorScheme(listener: () => void): () => void {
  schemeListeners.add(listener)
  return () => {
    schemeListeners.delete(listener)
  }
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
} as const

export const radii = {
  row: 6,
  card: 14,
  button: 6,
  input: 6,
  camera: 8,
  composer: 24,
  composerItem: 12
} as const

export const typography = {
  titleSize: 18,
  bodySize: 14,
  metaSize: 12,
  monoFamily: 'monospace' as const
} as const

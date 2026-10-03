import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  X
} from 'lucide-react-native'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import type { SmartNameSelection } from '../tasks/mobile-composer-source-types'
import type { MobileComposerSource } from '../tasks/use-mobile-composer-source'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TaskProviderLogo } from './TaskProviderLogo'

type Props = {
  composer: MobileComposerSource
  label: string
  disabled?: boolean
  onOpenExternalUrl: (url: string) => void
  // Why: only the active form view may focus this field. While the source drawer
  // is open/closing this stays non-focusable so the drawer's dismiss (which
  // restores native focus back here) can't re-fire onFocus and reopen the drawer.
  interactive: boolean
  onBeforeOpen?: () => void
  onOpenDrawer: () => void
}

function SelectionIcon({ kind }: { kind: SmartNameSelection['kind'] }) {
  const theme = useMobileTheme()
  if (kind === 'github-pr') {
    return <GitPullRequest size={16} color={theme.color.text.secondary} />
  }
  if (kind === 'gitlab-mr') {
    return <GitMerge size={16} color={theme.color.text.secondary} />
  }
  if (kind === 'github-issue' || kind === 'gitlab-issue') {
    return <CircleDot size={16} color={theme.color.text.secondary} />
  }
  if (kind === 'branch') {
    return <GitBranch size={16} color={theme.color.text.secondary} />
  }
  return <TaskProviderLogo provider="linear" size={16} color={theme.color.text.secondary} />
}

export function SmartWorkspaceSourceField({
  composer,
  label,
  disabled,
  onOpenExternalUrl,
  interactive,
  onBeforeOpen,
  onOpenDrawer
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const selection = composer.smartNameSelection

  function openDrawer(): void {
    if (disabled) {
      return
    }
    onBeforeOpen?.()
    onOpenDrawer()
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} <Text style={styles.labelHint}>[Optional]</Text>
      </Text>
      {selection ? (
        <View style={styles.pill}>
          <SelectionIcon kind={selection.kind} />
          <Text style={styles.pillLabel} numberOfLines={1}>
            {selection.label}
          </Text>
          {selection.url ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open selected source"
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
              onPress={() => {
                if (selection.url) {
                  onOpenExternalUrl(selection.url)
                }
              }}
            >
              <ExternalLink size={16} color={theme.color.text.tertiary} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear selected source"
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            onPress={composer.handleClearSmartNameSelection}
          >
            <X size={16} color={theme.color.text.tertiary} />
          </Pressable>
        </View>
      ) : (
        // Why: real TextInput (not a Pressable fake) so the typed value is the
        // same composer.name the source drawer docks — focus handoff keeps the
        // string continuous even though native focus moves to the docked field.
        <TextInput
          style={[styles.input, disabled && styles.disabled]}
          value={composer.name}
          onChangeText={composer.setName}
          onFocus={openDrawer}
          editable={!disabled && interactive}
          placeholder="Type a name or search a source"
          placeholderTextColor={theme.color.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          // Why: form field is a portal into the picker; return should not
          // submit the create form while the drawer is about to open.
          blurOnSubmit={false}
          showSoftInputOnFocus={false}
        />
      )}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    field: {
      marginBottom: theme.spacing.space16
    },
    label: {
      ...theme.typography.meta,
      fontWeight: '500',
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    labelHint: {
      fontWeight: '400',
      color: theme.color.text.tertiary
    },
    input: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      color: theme.color.text.primary
    },
    disabled: {
      opacity: 0.5
    },
    pill: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      paddingLeft: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    pillLabel: {
      flex: 1,
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    iconButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    }
  })
}

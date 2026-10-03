import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'

/** One row of the composer autocomplete: an agent slash command (with its
 *  catalog description, desktop parity) or a worktree file path. */
export type ComposerSuggestion =
  | { kind: 'command'; command: SlashCommandSuggestion }
  | { kind: 'file'; path: string }

export function composerSuggestionKey(suggestion: ComposerSuggestion): string {
  return suggestion.kind === 'command'
    ? `command:${suggestion.command.name}`
    : `file:${suggestion.path}`
}

/** The text the suggestion inserts at the trigger span. */
export function composerSuggestionInsertText(suggestion: ComposerSuggestion): string {
  return suggestion.kind === 'command' ? `/${suggestion.command.name}` : `@${suggestion.path}`
}

export function MobileNativeChatComposerSuggestions({
  suggestions,
  onPick
}: {
  suggestions: readonly ComposerSuggestion[]
  onPick: (suggestion: ComposerSuggestion) => void
}): React.JSX.Element {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.suggestions}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.suggestionScroll}>
        {suggestions.map((suggestion) => (
          <Pressable
            key={composerSuggestionKey(suggestion)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
            onPress={() => onPick(suggestion)}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>
              {composerSuggestionInsertText(suggestion)}
            </Text>
            {suggestion.kind === 'command' && suggestion.command.description ? (
              <Text style={styles.suggestionDescription} numberOfLines={1}>
                {suggestion.command.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    suggestions: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    suggestionScroll: {
      maxHeight: 220
    },
    suggestion: {
      minHeight: theme.size.groupedListRowMinHeight,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      gap: theme.spacing.space4
    },
    suggestionPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    suggestionText: {
      ...theme.typography.code,
      color: theme.color.text.primary
    },
    suggestionDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    }
  })
}

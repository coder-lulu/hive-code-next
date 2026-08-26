import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'

export type SetupTrustPrompt = {
  repoId: string
  repoName: string
  scriptContent: string
  contentHash: string
  previouslyApproved: boolean
}

type Props = {
  visible: boolean
  prompt: SetupTrustPrompt | null
  busy: boolean
  onRunOnce: () => void
  onAlwaysTrust: () => void
  onDontRun: () => void
  onClose: () => void
}

// The repo-owned orca.yaml setup-hook trust prompt, shown before a workspace
// create that would run an untrusted setup script. Extracted from NewWorktreeModal
// to keep that file focused; the async persist/create logic stays with the caller.
export function SetupHookTrustDrawer({
  visible,
  prompt,
  busy,
  onRunOnce,
  onAlwaysTrust,
  onDontRun,
  onClose
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <BottomDrawer visible={visible && prompt != null} onClose={onClose}>
      {prompt ? (
        <View>
          <View style={styles.trustHeader}>
            <Text style={styles.title}>
              {prompt.previouslyApproved
                ? `${prompt.repoName}'s setup script changed`
                : `Run setup from ${prompt.repoName}?`}
            </Text>
            <Text style={styles.subtitle}>
              This repository's orca.yaml runs before the workspace starts. Only run it if you trust
              this repository.
            </Text>
          </View>

          <View style={styles.trustScriptBox}>
            <Text style={styles.trustScriptLabel}>
              {prompt.previouslyApproved ? 'New setup script' : 'Setup script'}
            </Text>
            <Text style={styles.trustScriptText}>{prompt.scriptContent}</Text>
          </View>

          <View style={styles.trustActionGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run hooks once"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.trustPrimaryAction,
                busy && styles.trustActionDisabled,
                pressed && !busy && styles.trustActionPressed
              ]}
              disabled={busy}
              onPress={onRunOnce}
            >
              <Check size={16} color={theme.color.text.inverse} />
              <Text style={styles.trustPrimaryActionText}>Run hooks</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Always trust and run setup hooks"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.trustSecondaryAction,
                busy && styles.trustActionDisabled,
                pressed && !busy && styles.trustActionPressed
              ]}
              disabled={busy}
              onPress={onAlwaysTrust}
            >
              <Check size={16} color={theme.color.text.secondary} />
              <Text style={styles.trustSecondaryActionText}>Always trust and run</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Don't run setup hooks"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.trustTextAction,
                busy && styles.trustActionDisabled,
                pressed && !busy && styles.trustActionPressed
              ]}
              disabled={busy}
              onPress={onDontRun}
            >
              <Text style={styles.trustTextActionText}>Don&apos;t run</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}

function createStyles(theme: MobileTheme) {
  const actionBase = {
    minHeight: theme.size.minimumTouchTarget,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.spacing.space8,
    borderRadius: theme.radii.control,
    paddingHorizontal: theme.spacing.space16,
    paddingVertical: theme.spacing.space12
  }

  return StyleSheet.create({
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    subtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space8
    },
    trustHeader: {
      paddingHorizontal: theme.spacing.space4,
      marginBottom: theme.spacing.space16
    },
    trustScriptBox: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      padding: theme.spacing.space16,
      marginBottom: theme.spacing.space16
    },
    trustScriptLabel: {
      ...theme.typography.caption,
      fontWeight: '600',
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    trustScriptText: {
      ...theme.typography.code,
      color: theme.color.text.primary
    },
    trustActionGroup: {
      gap: theme.spacing.space8
    },
    trustPrimaryAction: {
      ...actionBase,
      backgroundColor: theme.color.bg.selected
    },
    trustPrimaryActionText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    trustSecondaryAction: {
      ...actionBase,
      backgroundColor: theme.color.bg.surface,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    trustSecondaryActionText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    trustTextAction: {
      ...actionBase
    },
    trustTextActionText: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    trustActionDisabled: {
      opacity: 0.5
    },
    trustActionPressed: {
      opacity: 0.72
    }
  })
}

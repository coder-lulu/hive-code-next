import { Pressable, Switch, Text, View } from 'react-native'
import type { WorkspaceCreateSetupDecision } from '../tasks/workspace-create-params'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createNewWorktreeModalStyles } from './new-worktree-modal-styles'
import type { SetupRunPolicy } from './new-worktree-modal-types'

export function NewWorkspaceSetupScriptField({
  command,
  source,
  runPolicy,
  decision,
  runSetup,
  onDecisionChange,
  onRunSetupChange
}: {
  command: string
  source: string | null
  runPolicy: SetupRunPolicy
  decision: Exclude<WorkspaceCreateSetupDecision, 'inherit'> | null
  runSetup: boolean
  onDecisionChange: (decision: Exclude<WorkspaceCreateSetupDecision, 'inherit'>) => void
  onRunSetupChange: (run: boolean) => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createNewWorktreeModalStyles)
  return (
    <View style={styles.field}>
      <View style={styles.setupHeader}>
        <Text style={styles.label}>Setup script</Text>
        {source ? (
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {source === 'orca.yaml' ? 'ORCA.YAML' : 'HOOKS'}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.setupBox}>
        {runPolicy === 'ask' ? (
          <View style={styles.setupChoiceRow}>
            <Pressable
              style={[
                styles.setupChoiceButton,
                decision === 'run' && styles.setupChoiceButtonSelected
              ]}
              onPress={() => onDecisionChange('run')}
            >
              <Text
                style={[
                  styles.setupChoiceText,
                  decision === 'run' && styles.setupChoiceTextSelected
                ]}
              >
                Run
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.setupChoiceButton,
                decision === 'skip' && styles.setupChoiceButtonSelected
              ]}
              onPress={() => onDecisionChange('skip')}
            >
              <Text
                style={[
                  styles.setupChoiceText,
                  decision === 'skip' && styles.setupChoiceTextSelected
                ]}
              >
                Skip
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.setupToggleRow}>
            <Text style={styles.setupToggleLabel}>Run setup command</Text>
            <Switch
              value={runSetup}
              onValueChange={onRunSetupChange}
              trackColor={{ false: theme.color.border.default, true: theme.color.text.secondary }}
              thumbColor={theme.color.text.primary}
              style={styles.setupSwitch}
            />
          </View>
        )}
        <View style={styles.setupCommandBlock}>
          <Text style={styles.setupCommand}>{command}</Text>
        </View>
      </View>
    </View>
  )
}

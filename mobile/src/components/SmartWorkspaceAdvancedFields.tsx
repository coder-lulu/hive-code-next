import { Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { MobileComposerSource } from '../tasks/use-mobile-composer-source'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  composer: MobileComposerSource
  selectedRepoIsGit: boolean
}

// The Advanced-section source controls: the editable Name appears once a source
// pill is shown (the field itself is no longer the name input); the branch-name
// override and reuse toggle mirror the desktop composer's advanced branch fields.
export function SmartWorkspaceAdvancedFields({ composer, selectedRepoIsGit }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const selection = composer.smartNameSelection
  const showBranchOverride = selectedRepoIsGit && (!selection || selection.kind === 'branch')
  return (
    <>
      {selection ? (
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={composer.name}
            onChangeText={composer.setName}
            placeholder="Workspace name"
            placeholderTextColor={theme.color.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {showBranchOverride ? (
        <View style={styles.field}>
          <Text style={styles.label}>Branch name</Text>
          <TextInput
            style={styles.input}
            value={composer.branchNameOverride ?? ''}
            onChangeText={composer.handleBranchNameOverrideChange}
            placeholder="Derived from name"
            placeholderTextColor={theme.color.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {composer.reuseEligibleBranch ? (
        <View style={styles.field}>
          <View style={styles.reuseRow}>
            <Text style={styles.reuseLabel} numberOfLines={1}>
              Reuse branch “{composer.reuseEligibleBranch}”
            </Text>
            <Switch
              value={composer.reuseSelectedBranch}
              onValueChange={composer.setReuseSelectedBranch}
              trackColor={{
                false: theme.color.border.default,
                true: theme.color.text.secondary
              }}
              thumbColor={theme.color.bg.surface}
              style={styles.reuseSwitch}
            />
          </View>
        </View>
      ) : null}
    </>
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
    input: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? theme.spacing.space12 : theme.spacing.space8,
      ...theme.typography.body,
      borderWidth: 1,
      borderColor: theme.color.border.default
    },
    reuseRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space12
    },
    reuseLabel: {
      flex: 1,
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    reuseSwitch: {
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }]
    }
  })
}

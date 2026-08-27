import { View, Text, Pressable, StyleSheet, Platform } from 'react-native'
import { ChevronDown, Monitor } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Selection = { label: string; detail?: string }

export function NewWorktreeProjectTargetFields({
  project,
  runTarget,
  projectBadgeColor,
  onOpenProject,
  onOpenRunTarget
}: {
  project: Selection | null
  runTarget: Selection | null
  projectBadgeColor: string | null
  onOpenProject: () => void
  onOpenRunTarget: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>Project</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select project"
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldButtonPressed]}
          onPress={onOpenProject}
        >
          {projectBadgeColor ? (
            <View style={[styles.projectDot, { backgroundColor: projectBadgeColor }]} />
          ) : null}
          <SelectionCopy selection={project} placeholder="Select a project" />
          <ChevronDown size={16} color={theme.color.text.tertiary} />
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Run on</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select run target"
          style={({ pressed }) => [styles.fieldButton, pressed && styles.fieldButtonPressed]}
          onPress={onOpenRunTarget}
        >
          <Monitor size={16} color={theme.color.text.secondary} />
          <SelectionCopy selection={runTarget} placeholder="Select a run target" />
          <ChevronDown size={16} color={theme.color.text.tertiary} />
        </Pressable>
      </View>
    </>
  )
}

function SelectionCopy({
  selection,
  placeholder
}: {
  selection: Selection | null
  placeholder: string
}) {
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.fieldButtonCopy}>
      <Text
        style={[styles.fieldButtonText, !selection && styles.fieldButtonPlaceholder]}
        numberOfLines={1}
      >
        {selection?.label ?? placeholder}
      </Text>
      {selection?.detail ? (
        <Text style={styles.fieldButtonDetail} numberOfLines={1}>
          {selection.detail}
        </Text>
      ) : null}
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
    fieldButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? theme.spacing.space12 : theme.spacing.space8
    },
    fieldButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    projectDot: {
      width: 8,
      height: 8,
      borderRadius: theme.radii.circle
    },
    fieldButtonCopy: {
      flex: 1,
      minWidth: 0
    },
    fieldButtonText: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    fieldButtonDetail: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    fieldButtonPlaceholder: {
      color: theme.color.text.tertiary
    }
  })
}

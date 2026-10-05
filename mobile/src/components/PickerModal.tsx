import { useMemo, type ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Check } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'

export type PickerOption<T extends string = string> = {
  value: T
  label: string
  subtitle?: string
  disabled?: boolean
  renderIcon?: (selected: boolean) => ReactNode
}

type Props<T extends string = string> = {
  visible: boolean
  title: string
  subtitle?: string
  options: PickerOption<T>[]
  selected: T
  onSelect: (value: T) => void
  onLongSelect?: (value: T) => void
  onClose: () => void
  onAfterClose?: () => void
  zIndex?: number
}

type PickerModalContentProps<T extends string = string> = Pick<
  Props<T>,
  'options' | 'selected' | 'onSelect' | 'onLongSelect' | 'onClose'
> & {
  readonly theme: MobileTheme
  readonly styles: ReturnType<typeof createPickerModalStyles>
}

export function PickerModal<T extends string = string>({
  visible,
  title,
  subtitle,
  options,
  selected,
  onSelect,
  onLongSelect,
  onClose,
  onAfterClose,
  zIndex
}: Props<T>) {
  const theme = useMobileTheme()
  const styles = useMemo(() => createPickerModalStyles(theme), [theme])

  return (
    <BottomDrawer visible={visible} onClose={onClose} onAfterClose={onAfterClose} zIndex={zIndex}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <PickerModalContent
        options={options}
        selected={selected}
        onSelect={onSelect}
        onLongSelect={onLongSelect}
        onClose={onClose}
        theme={theme}
        styles={styles}
      />
    </BottomDrawer>
  )
}

function PickerModalContent<T extends string = string>({
  options,
  selected,
  onSelect,
  onLongSelect,
  onClose,
  theme,
  styles
}: PickerModalContentProps<T>) {
  // Why: closed BottomDrawer instances return null, so keeping option rows in
  // this child avoids rebuilding hidden picker contents on every parent render.
  return (
    <View style={styles.group}>
      {options.map((opt, i) => {
        const isSelected = opt.value === selected
        return (
          <View key={opt.value}>
            {i > 0 && <View style={styles.separator} />}
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(opt.disabled), selected: isSelected }}
              disabled={opt.disabled}
              style={({ pressed }) => [
                styles.row,
                pressed && !opt.disabled && styles.rowPressed,
                opt.disabled && styles.rowDisabled
              ]}
              onPress={() => {
                if (opt.disabled) {
                  return
                }
                onSelect(opt.value)
                onClose()
              }}
              onLongPress={
                onLongSelect
                  ? () => {
                      if (opt.disabled) {
                        return
                      }
                      onLongSelect(opt.value)
                      onClose()
                    }
                  : undefined
              }
            >
              {opt.renderIcon ? (
                <View style={styles.rowIcon}>{opt.renderIcon(isSelected)}</View>
              ) : null}
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>
                  {opt.label}
                </Text>
                {opt.subtitle ? <Text style={styles.rowSubtitle}>{opt.subtitle}</Text> : null}
              </View>
              {isSelected && <Check size={18} color={theme.color.text.primary} strokeWidth={2} />}
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

export function createPickerModalStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space12
    },
    title: {
      ...theme.typography.meta,
      fontWeight: '500',
      color: theme.color.text.secondary
    },
    subtitle: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    group: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: theme.size.groupedListRowMinHeight,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    rowDisabled: {
      opacity: 0.45
    },
    rowContent: {
      flex: 1,
      minWidth: 0
    },
    rowIcon: {
      width: 22,
      alignItems: 'center',
      marginRight: theme.spacing.space8
    },
    rowLabel: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    rowLabelSelected: {
      fontWeight: '600'
    },
    rowSubtitle: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    }
  })
}

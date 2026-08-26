import { useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet, Switch } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'
import {
  buildTerminalShortcutKey,
  normalizeShortcutKeyInput,
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  type TerminalShortcutModifier,
  type TerminalShortcutSpecialKey
} from '../terminal/terminal-accessory-keys'

const CUSTOM_ACCESSORY_KEYS_STORAGE_KEY = 'orca:custom-accessory-keys'

export type CustomKey = {
  id: string
  label: string
  bytes: string
  enter: boolean
}

type Step = 'choose-type' | 'shortcut-combo' | 'special-keys' | 'text-macro'

// Why: Alt is rendered with the ⌥ glyph because on macOS hosts the Option key
// is the only modifier that produces an ESC-prefixed byte sequence terminals
// can read. Cmd is intentionally absent — macOS swallows it before keystrokes
// reach the shell, so there's nothing to encode.
const SHORTCUT_MODIFIERS: { id: TerminalShortcutModifier; label: string; glyph?: string }[] = [
  { id: 'ctrl', label: 'Ctrl' },
  { id: 'alt', label: 'Alt', glyph: '⌥' },
  { id: 'shift', label: 'Shift' }
]

// Why: special keys are grouped by purpose so the picker reads as three small
// fixed grids rather than one ragged wrap row that clipped F7-F12.
const SPECIAL_KEY_GROUPS: { title: string; ids: string[]; columns: number }[] = [
  {
    title: '编辑',
    ids: ['escape', 'tab', 'enter', 'backspace', 'delete', 'insert', 'space'],
    columns: 4
  },
  {
    title: '导航',
    ids: ['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight', 'home', 'end', 'pageUp', 'pageDown'],
    columns: 4
  },
  {
    title: '功能键',
    ids: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'],
    columns: 6
  }
]

const SPECIAL_KEY_BY_ID: Record<string, TerminalShortcutSpecialKey> = Object.fromEntries(
  TERMINAL_SHORTCUT_SPECIAL_KEYS.map((key) => [key.id, key])
)

type Props = {
  visible: boolean
  onClose: () => void
  onKeysChanged: (keys: CustomKey[]) => void
  onManageShortcuts?: () => void
}

export async function loadCustomKeys(): Promise<CustomKey[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CustomKey[]) : []
  } catch {
    return []
  }
}

export async function saveCustomKeys(keys: CustomKey[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY, JSON.stringify(keys))
}

export function CustomKeyModal({ visible, onClose, onKeysChanged, onManageShortcuts }: Props) {
  const theme = useMobileTheme()
  const styles = useMemo(() => createCustomKeyModalStyles(theme), [theme])
  const [step, setStep] = useState<Step>('choose-type')
  const [shortcutKey, setShortcutKey] = useState('c')
  const [shortcutModifiers, setShortcutModifiers] = useState<TerminalShortcutModifier[]>(['ctrl'])
  const [macroLabel, setMacroLabel] = useState('')
  const [macroText, setMacroText] = useState('')
  const [macroEnter, setMacroEnter] = useState(true)
  const [previousVisible, setPreviousVisible] = useState(visible)

  // Why: reset before the opening commit so the drawer does not flash the last
  // custom-key draft; keep close state unchanged for the slide-out animation.
  if (visible !== previousVisible) {
    setPreviousVisible(visible)
    if (visible) {
      setStep('choose-type')
      setShortcutKey('c')
      setShortcutModifiers(['ctrl'])
      setMacroLabel('')
      setMacroText('')
      setMacroEnter(true)
    }
  }

  const addKey = useCallback(
    async (key: Omit<CustomKey, 'id'>) => {
      const existing = await loadCustomKeys()
      const newKey: CustomKey = { ...key, id: `custom-${Date.now()}` }
      const updated = [...existing, newKey]
      await saveCustomKeys(updated)
      onKeysChanged(updated)
      onClose()
    },
    [onClose, onKeysChanged]
  )

  const shortcutPreview = useMemo(
    () => buildTerminalShortcutKey({ key: shortcutKey, modifiers: shortcutModifiers }),
    [shortcutKey, shortcutModifiers]
  )

  const previewKeyLabel = useMemo(() => {
    const special = SPECIAL_KEY_BY_ID[shortcutKey]
    if (special) {
      return special.label
    }
    return shortcutKey.length === 1 ? shortcutKey.toUpperCase() : shortcutKey
  }, [shortcutKey])

  const orderedActiveModifiers = useMemo(
    () => SHORTCUT_MODIFIERS.filter((m) => shortcutModifiers.includes(m.id)),
    [shortcutModifiers]
  )

  const toggleShortcutModifier = useCallback((modifier: TerminalShortcutModifier) => {
    setShortcutModifiers((current) =>
      current.includes(modifier)
        ? current.filter((item) => item !== modifier)
        : [...current, modifier]
    )
  }, [])

  const handleShortcutKeyInput = useCallback((value: string) => {
    if (value === '') {
      // Why: allow the field to go empty so backspace works; the Save button
      // stays disabled until a valid key is entered.
      setShortcutKey('')
      return
    }
    const next = normalizeShortcutKeyInput(value)
    if (next) {
      setShortcutKey(next)
    }
  }, [])

  const handleSpecialKeyPick = useCallback((id: string) => {
    setShortcutKey(id)
    setStep('shortcut-combo')
  }, [])

  const handleShortcutSave = useCallback(() => {
    const built = buildTerminalShortcutKey({ key: shortcutKey, modifiers: shortcutModifiers })
    if (!built) {
      return
    }
    void addKey({ label: built.label, bytes: built.bytes, enter: false })
  }, [addKey, shortcutKey, shortcutModifiers])

  const handleMacroSave = useCallback(() => {
    const label = macroLabel.trim() || macroText.trim().slice(0, 12)
    const text = macroText
    if (!label || !text) {
      return
    }
    const bytes = macroEnter ? `${text}\r` : text
    void addKey({ label, bytes, enter: false })
  }, [addKey, macroLabel, macroText, macroEnter])

  const showBack = step !== 'choose-type'
  const onBack = useCallback(() => {
    if (step === 'special-keys') {
      setStep('shortcut-combo')
    } else {
      setStep('choose-type')
    }
  }, [step])

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={onBack}
            accessibilityLabel="返回"
          >
            <ChevronLeft size={20} color={theme.color.text.secondary} strokeWidth={2} />
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <Text style={styles.title}>
          {step === 'choose-type' && '添加快捷键'}
          {step === 'shortcut-combo' && '组合快捷键'}
          {step === 'special-keys' && '选择按键'}
          {step === 'text-macro' && '文本宏'}
        </Text>
        <View style={styles.backSpacer} />
      </View>

      {step === 'choose-type' && (
        <View style={styles.group}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setStep('shortcut-combo')}
          >
            <Text style={styles.rowLabel}>组合快捷键</Text>
            <Text style={styles.rowHint}>组合 Ctrl、Alt 与 Shift 按键</Text>
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setStep('text-macro')}
          >
            <Text style={styles.rowLabel}>文本宏</Text>
            <Text style={styles.rowHint}>发送自定义文本命令</Text>
          </Pressable>
          {onManageShortcuts ? (
            <>
              <View style={styles.separator} />
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={onManageShortcuts}
              >
                <Text style={styles.rowLabel}>管理快捷键</Text>
                <Text style={styles.rowHint}>显示、隐藏或调整快捷键顺序</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}

      {step === 'shortcut-combo' && (
        <View style={styles.shortcutForm}>
          <View style={styles.preview}>
            {orderedActiveModifiers.map((modifier, index) => (
              <View key={modifier.id} style={styles.previewKeycapRow}>
                {index > 0 ? <Text style={styles.previewPlus}>+</Text> : null}
                <View style={[styles.keycap, styles.keycapModifier]}>
                  <Text style={styles.keycapModifierText}>{modifier.label}</Text>
                </View>
              </View>
            ))}
            {orderedActiveModifiers.length > 0 ? <Text style={styles.previewPlus}>+</Text> : null}
            <View style={[styles.keycap, !shortcutPreview && styles.keycapWarn]}>
              <Text style={[styles.keycapText, !shortcutPreview && styles.keycapTextWarn]}>
                {previewKeyLabel}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>修饰键</Text>
            <View style={styles.mods}>
              {SHORTCUT_MODIFIERS.map((modifier) => {
                const selected = shortcutModifiers.includes(modifier.id)
                return (
                  <Pressable
                    key={modifier.id}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && !selected && styles.chipPressed
                    ]}
                    onPress={() => toggleShortcutModifier(modifier.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {modifier.label}
                    </Text>
                    {modifier.glyph ? (
                      <Text style={[styles.chipGlyph, selected && styles.chipGlyphSelected]}>
                        {modifier.glyph}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>按键</Text>
            <TextInput
              style={styles.keyInput}
              value={shortcutKey.length === 1 ? shortcutKey.toUpperCase() : ''}
              onChangeText={handleShortcutKeyInput}
              placeholder={SPECIAL_KEY_BY_ID[shortcutKey]?.label ?? 'C'}
              placeholderTextColor={theme.color.text.tertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={1}
            />
            <Pressable
              style={({ pressed }) => [styles.moreLink, pressed && styles.moreLinkPressed]}
              onPress={() => setStep('special-keys')}
            >
              <Text style={styles.moreLinkText}>更多按键：Tab、方向键、F1–F12…</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.saveButton, !shortcutPreview && styles.saveButtonDisabled]}
            disabled={!shortcutPreview}
            onPress={handleShortcutSave}
          >
            <Text
              style={[styles.saveButtonText, !shortcutPreview && styles.saveButtonTextDisabled]}
            >
              添加
            </Text>
          </Pressable>
        </View>
      )}

      {step === 'special-keys' && (
        <View style={styles.specialKeysForm}>
          {SPECIAL_KEY_GROUPS.map((group) => (
            <View key={group.title} style={styles.specialGroup}>
              <Text style={styles.specialGroupTitle}>{group.title}</Text>
              <View style={styles.keyGrid}>
                {group.ids.map((id) => {
                  const key = SPECIAL_KEY_BY_ID[id]
                  if (!key) {
                    return null
                  }
                  const selected = shortcutKey === id
                  const flexBasis = `${100 / group.columns}%` as const
                  return (
                    <View key={id} style={[styles.keyCellWrap, { flexBasis }]}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.keyCell,
                          selected && styles.keyCellSelected,
                          pressed && !selected && styles.keyCellPressed
                        ]}
                        onPress={() => handleSpecialKeyPick(id)}
                        accessibilityLabel={key.accessibilityLabel}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.keyCellText, selected && styles.keyCellTextSelected]}>
                          {key.label}
                        </Text>
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            </View>
          ))}
        </View>
      )}

      {step === 'text-macro' && (
        <View style={styles.group}>
          <View style={styles.macroForm}>
            <Text style={styles.fieldLabel}>名称</Text>
            <TextInput
              style={styles.fieldInput}
              value={macroLabel}
              onChangeText={setMacroLabel}
              placeholder="例如：构建"
              placeholderTextColor={theme.color.text.tertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldLabel}>命令</Text>
            <TextInput
              style={styles.fieldInput}
              value={macroText}
              onChangeText={setMacroText}
              placeholder="例如：pnpm build"
              placeholderTextColor={theme.color.text.tertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>自动按下 Enter</Text>
              <Switch
                value={macroEnter}
                onValueChange={setMacroEnter}
                trackColor={{
                  false: theme.color.bg.subtle,
                  true: theme.color.bg.selected
                }}
                thumbColor={theme.color.text.inverse}
              />
            </View>
            <Pressable
              style={[styles.saveButton, !macroText.trim() && styles.saveButtonDisabled]}
              disabled={!macroText.trim()}
              onPress={handleMacroSave}
            >
              <Text
                style={[styles.saveButtonText, !macroText.trim() && styles.saveButtonTextDisabled]}
              >
                添加快捷键
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomDrawer>
  )
}

export function createCustomKeyModalStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: theme.spacing.space8
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    backButtonPressed: { backgroundColor: theme.color.bg.subtle },
    backSpacer: { width: theme.size.minimumTouchTarget },
    title: {
      ...theme.typography.sectionTitle,
      flex: 1,
      color: theme.color.text.primary,
      textAlign: 'center'
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
      marginHorizontal: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    rowPressed: { backgroundColor: theme.color.bg.subtle },
    rowLabel: {
      ...theme.typography.label,
      marginBottom: theme.spacing.space4,
      color: theme.color.text.primary
    },
    rowHint: { ...theme.typography.caption, color: theme.color.text.secondary },
    shortcutForm: { paddingTop: theme.spacing.space8 },
    preview: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space20
    },
    previewKeycapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    previewPlus: { ...theme.typography.sectionTitle, color: theme.color.text.tertiary },
    keycap: {
      minWidth: theme.spacing.space48,
      height: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    keycapModifier: { minWidth: 0 },
    keycapWarn: { borderColor: theme.color.status.warning },
    keycapText: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontSize: 17,
      fontWeight: '600'
    },
    keycapTextWarn: { color: theme.color.status.warning },
    keycapModifierText: {
      ...theme.typography.code,
      color: theme.color.text.secondary,
      fontSize: 14,
      fontWeight: '600'
    },
    section: { marginTop: theme.spacing.space12 },
    sectionLabel: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space8,
      paddingLeft: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    mods: { flexDirection: 'row', gap: theme.spacing.space8 },
    chip: {
      minHeight: theme.size.minimumTouchTarget,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    chipSelected: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    chipPressed: { backgroundColor: theme.color.bg.subtle },
    chipText: { ...theme.typography.label, color: theme.color.text.secondary },
    chipTextSelected: { color: theme.color.text.inverse },
    chipGlyph: { ...theme.typography.code, color: theme.color.text.tertiary },
    chipGlyphSelected: { color: theme.color.text.inverse, opacity: 0.55 },
    keyInput: {
      width: '100%',
      height: 56,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      fontFamily: theme.typography.code.fontFamily,
      fontSize: 22,
      fontWeight: '600',
      textAlign: 'center'
    },
    moreLink: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space8
    },
    moreLinkPressed: { opacity: 0.6 },
    moreLinkText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textDecorationLine: 'underline'
    },
    specialKeysForm: {
      gap: theme.spacing.space12,
      paddingTop: theme.spacing.space4,
      paddingBottom: theme.spacing.space12
    },
    specialGroup: { gap: theme.spacing.space4 },
    specialGroupTitle: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space4,
      paddingLeft: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
    keyGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -theme.spacing.space4 / 2
    },
    keyCellWrap: {
      paddingHorizontal: theme.spacing.space4 / 2,
      paddingVertical: theme.spacing.space4 / 2
    },
    keyCell: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    keyCellPressed: { backgroundColor: theme.color.bg.subtle },
    keyCellSelected: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    keyCellText: {
      ...theme.typography.code,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    keyCellTextSelected: { color: theme.color.text.inverse },
    macroForm: { gap: theme.spacing.space8, padding: theme.spacing.space16 },
    fieldLabel: { ...theme.typography.label, color: theme.color.text.secondary },
    fieldInput: {
      minHeight: theme.spacing.space48,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.canvas,
      color: theme.color.text.primary,
      fontFamily: theme.typography.code.fontFamily,
      fontSize: theme.typography.label.fontSize
    },
    switchRow: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.space4
    },
    switchLabel: { ...theme.typography.label, color: theme.color.text.primary },
    saveButton: {
      minHeight: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    saveButtonDisabled: { backgroundColor: theme.color.bg.subtle },
    saveButtonText: { ...theme.typography.label, color: theme.color.text.inverse },
    saveButtonTextDisabled: { color: theme.color.text.tertiary }
  })
}

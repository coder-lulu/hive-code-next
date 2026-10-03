import { useEffect, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { MobileFilePreviewLineColumn } from './mobile-file-preview-line-column'
import { textOffsetForLineColumn } from './mobile-file-preview-line-column'
import { createFilePreviewStyles } from './mobile-file-preview-styles'

type Props = {
  title: string
  draftContent: string
  lineColumn: MobileFilePreviewLineColumn | null
  saveError?: string
  onDraftChange: (content: string) => void
}

export function MobileFilePreviewEditableSource({
  title,
  draftContent,
  lineColumn,
  saveError,
  onDraftChange
}: Props) {
  const styles = useMobileThemeStyles(createFilePreviewStyles)
  const selectionTargetKey = lineColumn
    ? `${title}:${lineColumn.line}:${lineColumn.column ?? ''}`
    : ''
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [revealedTargetKey, setRevealedTargetKey] = useState('')

  // Why: line/column opens should reveal once, then user cursor movement owns selection.
  useEffect(() => {
    if (!lineColumn || !selectionTargetKey || revealedTargetKey === selectionTargetKey) {
      return
    }
    const offset = textOffsetForLineColumn(draftContent, lineColumn)
    const initialSelection = { start: offset, end: offset }
    setSelection(initialSelection)
    setRevealedTargetKey(selectionTargetKey)
  }, [draftContent, lineColumn, revealedTargetKey, selectionTargetKey])

  return (
    <View style={styles.editContainer}>
      {saveError ? <Text style={styles.saveErrorText}>{saveError}</Text> : null}
      <TextInput
        style={styles.editInput}
        value={draftContent}
        onChangeText={onDraftChange}
        multiline
        textAlignVertical="top"
        autoCapitalize="none"
        autoCorrect={false}
        selection={selection ?? undefined}
        onSelectionChange={() => setSelection(null)}
        accessibilityLabel={`${title} 编辑器`}
      />
    </View>
  )
}

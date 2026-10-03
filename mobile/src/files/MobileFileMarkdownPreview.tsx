import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Code, Pencil } from 'lucide-react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  MobileFilePreviewSourceText,
  MobileFilePreviewTruncatedNote
} from './MobileFilePreviewSourceText'
import { createFilePreviewStyles } from './mobile-file-preview-styles'

type Props = {
  relativePath: string
  content: string
  truncated: boolean
  byteLength: number
  initialLine?: number
}

export function MobileFileMarkdownPreview({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createFilePreviewStyles)
  const [mode, setMode] = useState<'preview' | 'source'>(() => (initialLine ? 'source' : 'preview'))
  const [previousRelativePath, setPreviousRelativePath] = useState(relativePath)
  const [previousInitialLine, setPreviousInitialLine] = useState(initialLine)
  // Why: opening a different file or line target must switch modes before paint,
  // never briefly retain the prior file's manually selected mode.
  if (relativePath !== previousRelativePath || initialLine !== previousInitialLine) {
    setPreviousRelativePath(relativePath)
    setPreviousInitialLine(initialLine)
    setMode(initialLine ? 'source' : 'preview')
  }
  const previewSelected = mode === 'preview'
  const sourceSelected = mode === 'source'

  return (
    <View style={styles.modeContainer}>
      <View style={styles.modeToolbar}>
        <Pressable
          style={[styles.modeToggle, sourceSelected && styles.modeToggleActive]}
          onPress={() => setMode('source')}
          accessibilityRole="button"
          accessibilityState={{ selected: sourceSelected }}
          accessibilityLabel="查看 Markdown 源码"
        >
          <Code
            size={15}
            color={sourceSelected ? theme.color.text.inverse : theme.color.text.secondary}
            strokeWidth={2.2}
          />
        </Pressable>
        <Pressable
          style={[styles.modeToggle, previewSelected && styles.modeToggleActive]}
          onPress={() => setMode('preview')}
          accessibilityRole="button"
          accessibilityState={{ selected: previewSelected }}
          accessibilityLabel="查看 Markdown 预览"
        >
          <Pencil
            size={15}
            color={previewSelected ? theme.color.text.inverse : theme.color.text.secondary}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>
      {mode === 'preview' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.markdownContent}>
          {truncated ? <MobileFilePreviewTruncatedNote byteLength={byteLength} /> : null}
          <MobileMarkdown content={content} />
        </ScrollView>
      ) : (
        <MobileFilePreviewSourceText
          relativePath={relativePath}
          content={content}
          truncated={truncated}
          byteLength={byteLength}
          initialLine={initialLine}
        />
      )}
    </View>
  )
}

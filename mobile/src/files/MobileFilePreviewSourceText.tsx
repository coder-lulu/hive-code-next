import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, Text } from 'react-native'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { formatPreviewByteLength } from './mobile-file-preview-request'
import { scrollOffsetForPreviewLine } from './mobile-file-preview-line-column'
import { buildMobileFilePreviewSyntax } from './mobile-file-preview-syntax'
import { createFilePreviewStyles } from './mobile-file-preview-styles'

export function MobileFilePreviewSourceText({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine
}: {
  relativePath: string
  content: string
  truncated?: boolean
  byteLength?: number
  initialLine?: number
}) {
  const styles = useMobileThemeStyles(createFilePreviewStyles)
  const scrollRef = useRef<ScrollView>(null)
  const revealedRef = useRef(false)
  const syntax = useMemo(
    () => buildMobileFilePreviewSyntax(relativePath, content),
    [content, relativePath]
  )

  useEffect(() => {
    revealedRef.current = false
  }, [content, initialLine, relativePath])

  const revealInitialLine = () => {
    if (!initialLine || revealedRef.current) {
      return
    }
    revealedRef.current = true
    scrollRef.current?.scrollTo({
      y: scrollOffsetForPreviewLine(initialLine),
      animated: false
    })
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.sourceScroll}
      contentContainerStyle={styles.textContent}
      onContentSizeChange={revealInitialLine}
    >
      {truncated ? (
        <MobileFilePreviewTruncatedNote byteLength={byteLength ?? content.length} />
      ) : null}
      <Text selectable style={styles.textPreview} accessibilityLabel="文件预览">
        <MobileSyntaxSegments segments={syntax.segments} />
      </Text>
    </ScrollView>
  )
}

export function MobileFilePreviewTruncatedNote({ byteLength }: { byteLength: number }) {
  const styles = useMobileThemeStyles(createFilePreviewStyles)

  return (
    <Text style={styles.truncatedNote}>
      预览已截断，文件大小：{formatPreviewByteLength(byteLength)}。
    </Text>
  )
}

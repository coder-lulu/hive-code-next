import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  Image as ImageIcon
} from 'lucide-react-native'
import { triggerSelection } from '../platform/haptics'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { type FileExplorerRow, isMarkdownPath, type TreeNode } from './file-tree'
import { createFileExplorerStyles } from './mobile-file-explorer-styles'
import { canPreviewMobileFileRow } from './mobile-file-preview-navigation'

type Props = {
  item: FileExplorerRow
  expanded: ReadonlySet<string>
  onPreviewFile: (relativePath: string, displayName: string) => void
  onRetryDirectory: (relativePath: string) => void
  onToggleDirectory: (relativePath: string) => void
}

export function MobileFileExplorerRow(props: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createFileExplorerStyles)
  const { item, expanded, onPreviewFile, onRetryDirectory, onToggleDirectory } = props

  if (item.kind === 'loading') {
    return (
      <View
        style={[styles.inlineStatusRow, { paddingLeft: theme.spacing.space16 + item.depth * 18 }]}
      >
        <View style={styles.chevronSpacer} />
        <ActivityIndicator size="small" color={theme.color.text.secondary} />
        <Text style={styles.inlineStatusText}>正在加载…</Text>
      </View>
    )
  }

  if (item.kind === 'error') {
    return (
      <View
        style={[styles.inlineStatusRow, { paddingLeft: theme.spacing.space16 + item.depth * 18 }]}
      >
        <View style={styles.chevronSpacer} />
        <Text style={styles.inlineErrorText} numberOfLines={1}>
          {item.message || '无法加载文件夹'}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.inlineRetryButton, pressed && styles.rowPressed]}
          onPress={() => {
            triggerSelection()
            onRetryDirectory(item.relativePath)
          }}
          accessibilityLabel={`重试加载 ${item.relativePath}`}
        >
          <Text style={styles.inlineRetryText}>重试</Text>
        </Pressable>
      </View>
    )
  }

  if (isTreeNode(item)) {
    return (
      <TreeRow
        item={item}
        expanded={expanded}
        onPreviewFile={onPreviewFile}
        onToggleDirectory={onToggleDirectory}
      />
    )
  }

  return null
}

function isTreeNode(item: FileExplorerRow): item is TreeNode {
  return item.kind === 'directory' || item.kind === 'text' || item.kind === 'binary'
}

function TreeRow(props: {
  item: TreeNode
  expanded: ReadonlySet<string>
  onPreviewFile: (relativePath: string, displayName: string) => void
  onToggleDirectory: (relativePath: string) => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createFileExplorerStyles)
  const { item, expanded, onPreviewFile, onToggleDirectory } = props
  const isDirectory = item.kind === 'directory'
  const isExpanded = expanded.has(item.relativePath)
  // Images render in the mobile viewer (via files.readPreview), so a binary
  // image is openable; only non-previewable binaries are unavailable.
  const previewable =
    item.kind !== 'directory' &&
    canPreviewMobileFileRow({ kind: item.kind, relativePath: item.relativePath })
  const isImage = item.kind === 'binary' && previewable
  const disabled = item.kind === 'binary' && !previewable
  const markdown = item.kind === 'text' && isMarkdownPath(item.relativePath)

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: theme.spacing.space16 + item.depth * 18 },
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled
      ]}
      disabled={disabled}
      onPress={() => {
        triggerSelection()
        if (isDirectory) {
          onToggleDirectory(item.relativePath)
        } else if (!disabled) {
          onPreviewFile(item.relativePath, item.name)
        }
      }}
      accessibilityLabel={
        isDirectory
          ? `打开文件夹 ${item.name}`
          : disabled
            ? `${item.name} 在移动端不可用`
            : `预览文件 ${item.name}`
      }
    >
      {isDirectory ? (
        isExpanded ? (
          <ChevronDown size={16} color={theme.color.text.secondary} />
        ) : (
          <ChevronRight size={16} color={theme.color.text.secondary} />
        )
      ) : (
        <View style={styles.chevronSpacer} />
      )}
      {isDirectory ? (
        <Folder size={17} color={theme.color.text.secondary} />
      ) : markdown ? (
        <FileText
          size={17}
          color={disabled ? theme.color.text.tertiary : theme.color.text.secondary}
        />
      ) : isImage ? (
        <ImageIcon size={17} color={theme.color.text.secondary} />
      ) : (
        <File size={17} color={disabled ? theme.color.text.tertiary : theme.color.text.secondary} />
      )}
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowTitle, disabled && styles.rowTitleDisabled]} numberOfLines={1}>
          {item.name}
        </Text>
        {disabled ? <Text style={styles.rowMeta}>移动端暂不支持</Text> : null}
      </View>
    </Pressable>
  )
}

import { memo, useState } from 'react'
import { Image, Linking, Pressable, Text, View } from 'react-native'
import { Check, CornerDownRight, ExternalLink, Pencil, Trash2, Undo2 } from 'lucide-react-native'
import type {
  GitHubReaction,
  GitHubReactionContent,
  PRComment
} from '../../../../src/shared/github/comment-types'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import { canEditComment, isResolvableComment } from '../../session/pr-comment-actions'
import { ConfirmModal } from '../ConfirmModal'
import { CommentMarkdown } from './CommentMarkdown'
import { PRCommentComposer } from './PRCommentComposer'
import { formatPrCommentRelativeTime } from '../../../../src/shared/pr-comment-time'
import { createPrCommentsStyles } from './pr-comments-styles'

export type PRCommentRepoSlug = { owner: string; repo: string; host?: string }

// Action handlers are passed from the comment actions hook (stable callbacks), so
// adding them keeps the memo'd card from re-rendering on unrelated timeline changes.
export type PRCommentCardActions = {
  reply: (comment: PRComment, body: string) => Promise<boolean>
  toggleResolve: (comment: PRComment) => Promise<boolean>
  editComment: (commentId: number, body: string) => Promise<boolean>
  deleteComment: (commentId: number) => Promise<boolean>
  isReplyBusy: (commentId: number) => boolean
  isResolveBusy: (threadId: string) => boolean
  isEditBusy: (commentId: number) => boolean
  isDeleteBusy: (commentId: number) => boolean
  // Repo slug for the slug-addressed edit/delete RPCs; gates the affordances when absent.
  prRepo: PRCommentRepoSlug | null
}

const REACTION_EMOJI: Record<GitHubReactionContent, string> = {
  '+1': '👍',
  '-1': '👎',
  laugh: '😄',
  confused: '😕',
  heart: '❤️',
  hooray: '🎉',
  rocket: '🚀',
  eyes: '👀'
}

function Reactions({ reactions }: { reactions?: GitHubReaction[] }) {
  const styles = useMobileThemeStyles(createPrCommentsStyles)
  const visible = (reactions ?? []).filter((r) => r.count > 0)
  if (visible.length === 0) {
    return null
  }
  return (
    <View style={styles.reactionsRow}>
      {visible.map((r) => (
        <View key={r.content} style={styles.reactionChip}>
          <Text>{REACTION_EMOJI[r.content]}</Text>
          <Text style={styles.reactionText}>{r.count}</Text>
        </View>
      ))}
    </View>
  )
}

// One PR comment (or review-thread reply), mirroring the desktop comment card:
// avatar + author + relative time + inline file:line + resolved chip + open-on-
// GitHub, then the markdown body and reactions. When `actions` is provided the
// card grows a Reply composer and (for review threads) a Resolve/Unresolve toggle.
export const PRCommentCard = memo(function PRCommentCard({
  comment,
  isReply = false,
  actions,
  now
}: {
  comment: PRComment
  isReply?: boolean
  actions?: PRCommentCardActions
  now: number
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createPrCommentsStyles)
  const [replyOpen, setReplyOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileLabel = comment.path
    ? `${comment.path.split('/').pop()}${comment.line ? `:L${comment.line}` : ''}`
    : null
  const canResolve = actions ? isResolvableComment(comment) : false
  const resolveBusy =
    canResolve && actions ? actions.isResolveBusy(comment.threadId as string) : false
  const replyBusy = actions ? actions.isReplyBusy(comment.id) : false
  // Edit/delete are offered only on mutable root conversation comments with a repo
  // slug; GitHub enforces authorship server-side (no client viewer-identity field).
  const canMutate = actions ? canEditComment(comment, actions.prRepo) : false
  const editBusy = actions ? actions.isEditBusy(comment.id) : false
  const deleteBusy = actions ? actions.isDeleteBusy(comment.id) : false

  const submitReply = async (body: string): Promise<boolean> => {
    if (!actions) {
      return false
    }
    const ok = await actions.reply(comment, body)
    if (ok) {
      setReplyOpen(false)
    }
    return ok
  }

  const submitEdit = async (body: string): Promise<boolean> => {
    if (!actions) {
      return false
    }
    const ok = await actions.editComment(comment.id, body)
    if (ok) {
      setEditOpen(false)
    }
    return ok
  }

  return (
    <View style={[styles.card, isReply && styles.reply, comment.isResolved && styles.cardResolved]}>
      <View style={styles.header}>
        {comment.authorAvatarUrl ? (
          <Image source={{ uri: comment.authorAvatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar} />
        )}
        <Text
          style={[styles.author, comment.isResolved && styles.authorResolved]}
          numberOfLines={1}
        >
          {comment.author}
        </Text>
        <Text style={styles.time}>· {formatPrCommentRelativeTime(comment.createdAt, now)}</Text>
        {fileLabel ? (
          <Text style={styles.path} numberOfLines={1}>
            {fileLabel}
          </Text>
        ) : null}
        {comment.isResolved ? (
          <View style={styles.resolvedChip}>
            <Text style={styles.resolvedChipText}>已解决</Text>
          </View>
        ) : null}
        {comment.url ? (
          <Pressable
            style={styles.openButton}
            onPress={() => void Linking.openURL(comment.url).catch(() => {})}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="在 GitHub 上打开评论"
          >
            <ExternalLink size={14} color={theme.color.text.secondary} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {editOpen && actions ? (
        <View style={styles.composer}>
          <PRCommentComposer
            placeholder="编辑评论…"
            submitLabel="保存"
            submitting={editBusy}
            initialBody={comment.body}
            onSubmit={submitEdit}
            onCancel={() => setEditOpen(false)}
            autoFocus
          />
        </View>
      ) : (
        <View style={styles.body}>
          <CommentMarkdown content={comment.body} />
          <Reactions reactions={comment.reactions} />
        </View>
      )}
      {actions && !editOpen ? (
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => setReplyOpen((v) => !v)}
            disabled={replyBusy}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="回复评论"
          >
            <CornerDownRight size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
            <Text style={styles.actionButtonText}>回复</Text>
          </Pressable>
          {canMutate ? (
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPress={() => {
                // Only one composer open at a time: entering Edit closes any open Reply.
                setReplyOpen(false)
                setEditOpen(true)
              }}
              disabled={editBusy}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="编辑评论"
            >
              <Pencil size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
              <Text style={styles.actionButtonText}>编辑</Text>
            </Pressable>
          ) : null}
          {canMutate ? (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonDanger,
                pressed && styles.actionButtonPressed
              ]}
              onPress={() => setConfirmDelete(true)}
              disabled={deleteBusy}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="删除评论"
            >
              <Trash2 size={13} color={theme.color.status.danger} strokeWidth={2.2} />
              <Text style={[styles.actionButtonText, styles.actionButtonDangerText]}>
                {deleteBusy ? '…' : '删除'}
              </Text>
            </Pressable>
          ) : null}
          {canResolve ? (
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPress={() => void actions.toggleResolve(comment)}
              disabled={resolveBusy}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={comment.isResolved ? '取消解决讨论串' : '解决讨论串'}
            >
              {comment.isResolved ? (
                <Undo2 size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
              ) : (
                <Check size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
              )}
              <Text style={styles.actionButtonText}>
                {resolveBusy ? '…' : comment.isResolved ? '取消解决' : '解决'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {replyOpen && !editOpen && actions ? (
        <View style={styles.composer}>
          <PRCommentComposer
            placeholder="撰写回复…"
            submitLabel="回复"
            submitting={replyBusy}
            onSubmit={submitReply}
            onCancel={() => setReplyOpen(false)}
            autoFocus
          />
        </View>
      ) : null}
      {actions ? (
        <ConfirmModal
          visible={confirmDelete}
          title="删除评论？"
          message="此操作会永久删除 GitHub 上的评论。"
          confirmLabel="删除"
          destructive
          onConfirm={() => void actions.deleteComment(comment.id)}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </View>
  )
})

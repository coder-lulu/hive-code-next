import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { GitHubAssignableUser } from '../../../../src/shared/github/pull-request-types'
import type { RpcClient } from '../../transport/rpc-client'
import { fetchAssignableUsers } from '../../session/github-pr-rpc'
import { BottomDrawer } from '../BottomDrawer'
import { createMobilePrSidebarStyles } from './mobile-pr-sidebar-styles'
import { createReviewerPickerStyles } from './reviewer-picker-styles'

type Props = {
  visible: boolean
  onClose: () => void
  client: RpcClient | null
  worktreeId: string
  // Logins already requested/reviewing (+ author) — surfaced at the top of the list.
  seededLogins: string[]
  // Resolves the optimistic requested-state for a login (so a just-toggled row reflects it).
  isRequested: (login: string) => boolean
  onToggle: (login: string) => void
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; users: GitHubAssignableUser[] }

// Searchable assignable-user list in a BottomDrawer. Mapped rows (not FlatList):
// this drawer is opened from the PR ScrollView, and a VirtualizedList nested in
// that ScrollView throws and can leave the Reviewers section blank.
// Seeded reviewers + author sort first for quick un-request.
export function ReviewerPickerDrawer({
  visible,
  onClose,
  client,
  worktreeId,
  seededLogins,
  isRequested,
  onToggle
}: Props) {
  const theme = useMobileTheme()
  const shared = useMobileThemeStyles(createMobilePrSidebarStyles)
  const styles = useMobileThemeStyles(createReviewerPickerStyles)
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    let cancelled = false
    setLoad({ status: 'loading' })
    void fetchAssignableUsers(client, worktreeId)
      .then((outcome) => {
        if (cancelled) {
          return
        }
        setLoad(
          outcome.ok
            ? { status: 'loaded', users: outcome.result }
            : { status: 'error', message: outcome.error }
        )
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ status: 'error', message: '无法加载用户' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [visible, client, worktreeId])

  const ordered = useMemo(() => {
    if (load.status !== 'loaded') {
      return []
    }
    const seed = new Set(seededLogins.map((l) => l.toLowerCase()))
    // Seeded reviewers sort first so the user can quickly un-request them.
    const sorted = [...load.users].sort((a, b) => {
      const aSeed = seed.has(a.login.toLowerCase()) ? 0 : 1
      const bSeed = seed.has(b.login.toLowerCase()) ? 0 : 1
      return aSeed - bSeed || a.login.localeCompare(b.login)
    })
    const q = query.trim().toLowerCase()
    if (!q) {
      return sorted
    }
    return sorted.filter(
      (u) => u.login.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)
    )
  }, [load, seededLogins, query])

  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss={false}>
      <Text style={styles.title}>审阅者</Text>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索用户"
        placeholderTextColor={theme.color.text.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {load.status === 'loading' ? (
        <View style={styles.stateArea}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : load.status === 'error' ? (
        <View style={styles.stateArea}>
          <Text style={shared.emptyText}>{load.message}</Text>
        </View>
      ) : ordered.length === 0 ? (
        <View style={styles.stateArea}>
          <Text style={shared.emptyText}>没有匹配的用户</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {ordered.map((item) => {
            const requested = isRequested(item.login)
            return (
              <Pressable
                key={item.login}
                style={styles.row}
                onPress={() => onToggle(item.login)}
                accessibilityRole="button"
                accessibilityState={{ selected: requested }}
                accessibilityLabel={`${requested ? '移除' : '请求审阅'} ${item.login}`}
              >
                <View style={shared.rowTrailing}>
                  {requested ? (
                    <Check size={16} color={theme.color.text.primary} strokeWidth={2.4} />
                  ) : null}
                </View>
                <View style={styles.rowMain}>
                  <Text style={shared.rowTitle} numberOfLines={1}>
                    {item.name ? `${item.name} (${item.login})` : item.login}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      )}
    </BottomDrawer>
  )
}

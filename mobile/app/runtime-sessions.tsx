import { useCallback, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileAuthSession } from '../src/auth/mobile-auth-session'
import {
  FutureFeatureAction,
  FutureFeatureNotice,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../src/capabilities/FutureFeatureUI'
import { useAccountRuntimeDirectory } from '../src/runtime-directory/account-runtime-directory-provider'
import type { RuntimeSession } from '../src/runtime-directory/account-runtime-directory-types'

const STATUS_LABELS: Record<RuntimeSession['status'], string> = {
  PENDING_ACTIVATION: '等待激活',
  ACTIVE: '在线',
  CLOSED: '已结束',
  REVOKE_PENDING: '正在撤销',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
  UNVERIFIABLE: '连接已失效'
}

const CLIENT_LABELS: Record<RuntimeSession['clientKind'], string> = {
  WEB: 'Web',
  DESKTOP: '电脑',
  MOBILE: '手机'
}

type ScopedSessions = {
  readonly scopeKey: string
  readonly items: RuntimeSession[]
  readonly cursors: (string | null)[]
  readonly nextCursor: string | null
}

type ScopedError = { readonly scopeKey: string; readonly message: string }
type RevokeOperation = {
  readonly operationId: number
  readonly scopeKey: string
  readonly id: string
}

export default function RuntimeSessionsScreen() {
  const { hydrated, session: accountSession } = useMobileAuthSession()
  const { listSessions, revokeSession } = useAccountRuntimeDirectory()
  const scopeKey = accountSession
    ? JSON.stringify([accountSession.authorityId, accountSession.account.accountId])
    : null
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  const generationRef = useRef(0)
  const revokeOperationRef = useRef(0)
  const [loaded, setLoaded] = useState<ScopedSessions | null>(null)
  const [loadingScope, setLoadingScope] = useState<string | null>(null)
  const [scopedError, setScopedError] = useState<ScopedError | null>(null)
  const [revokeOperation, setRevokeOperation] = useState<RevokeOperation | null>(null)
  const sessions = loaded?.scopeKey === scopeKey ? loaded.items : []
  const loading = loadingScope === scopeKey
  const error = scopedError?.scopeKey === scopeKey ? scopedError.message : null
  const revokingId = revokeOperation?.scopeKey === scopeKey ? revokeOperation.id : null
  const page = loaded?.scopeKey === scopeKey ? loaded : null

  const loadPage = useCallback(
    async (cursors: (string | null)[] = [null]) => {
      const generation = ++generationRef.current
      const requestedScope = scopeKey
      if (!requestedScope) {
        setLoaded(null)
        setScopedError(null)
        setLoadingScope(null)
        return
      }
      setLoadingScope(requestedScope)
      setScopedError((current) => (current?.scopeKey === requestedScope ? null : current))
      try {
        const next = await listSessions(cursors.at(-1) ?? null)
        if (generation === generationRef.current && scopeRef.current === requestedScope) {
          setLoaded({ scopeKey: requestedScope, ...next, cursors })
        }
      } catch {
        if (generation === generationRef.current && scopeRef.current === requestedScope) {
          setScopedError({
            scopeKey: requestedScope,
            message: '无法读取 Runtime 会话，请稍后重试。'
          })
        }
      } finally {
        if (generation === generationRef.current && scopeRef.current === requestedScope) {
          setLoadingScope(null)
        }
      }
    },
    [listSessions, scopeKey]
  )

  useFocusEffect(
    useCallback(() => {
      void loadPage()
      return () => {
        generationRef.current += 1
      }
    }, [loadPage])
  )

  const revoke = useCallback(
    async (target: RuntimeSession, requestedScope: string) => {
      if (scopeRef.current !== requestedScope) {
        return
      }
      const operationId = ++revokeOperationRef.current
      setRevokeOperation({ operationId, scopeKey: requestedScope, id: target.managedSessionId })
      try {
        const updated = await revokeSession(target)
        if (scopeRef.current === requestedScope) {
          setLoaded((current) =>
            current?.scopeKey === requestedScope
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.managedSessionId === updated.managedSessionId
                      ? { ...item, ...updated }
                      : item
                  )
                }
              : current
          )
        }
      } catch {
        if (scopeRef.current === requestedScope) {
          Alert.alert('撤销失败', '无法撤销此 Runtime 会话，请刷新后重试。')
        }
      } finally {
        setRevokeOperation((current) => (current?.operationId === operationId ? null : current))
      }
    },
    [revokeSession]
  )

  const confirmRevoke = useCallback(
    (target: RuntimeSession) => {
      const requestedScope = scopeRef.current
      if (!requestedScope) {
        return
      }
      Alert.alert(
        '撤销 Runtime 会话？',
        '该客户端会立即失去账号访问权限。本地扫码配对和本地凭据不会被删除。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '撤销',
            style: 'destructive',
            onPress: () => void revoke(target, requestedScope)
          }
        ]
      )
    },
    [revoke]
  )

  const signedIn = hydrated && scopeKey !== null
  return (
    <FutureFeatureScreen
      capabilityId="account"
      title="Runtime 会话"
      description="查看当前账号在 Web、电脑和手机上的 Runtime 访问会话，并强制撤销不再使用的会话。"
    >
      <FutureFeatureNotice title={signedIn ? '账号会话' : '请先登录'}>
        {signedIn
          ? '撤销只影响账号云端访问；匿名本地配对始终独立保留。'
          : '登录账号后才能查看和撤销 Runtime 会话。'}
      </FutureFeatureNotice>

      <FutureFeatureSection title="会话列表">
        {!signedIn ? (
          <FutureFeatureRow label="Runtime 会话" value="未登录" />
        ) : error ? (
          <FutureFeatureRow detail={error} label="加载失败" value="可重试" />
        ) : loading && sessions.length === 0 ? (
          <FutureFeatureRow label="Runtime 会话" value="读取中" />
        ) : sessions.length === 0 ? (
          <FutureFeatureRow label="Runtime 会话" value="暂无会话" />
        ) : (
          sessions.map((item) => {
            const canRevoke =
              (item.status === 'ACTIVE' || item.status === 'PENDING_ACTIVATION') &&
              revokingId === null &&
              !loading
            const client = CLIENT_LABELS[item.clientKind]
            const label = item.clientLabel ? `${client} · ${item.clientLabel}` : client
            const detail = `Runtime ${item.runtimeRecordId.slice(0, 8)} · ${new Date(item.createdAt).toLocaleString()}`
            return (
              <FutureFeatureRow
                destructive={canRevoke}
                detail={detail}
                disabled={!canRevoke}
                key={item.managedSessionId}
                label={label}
                value={
                  revokingId === item.managedSessionId ? '正在撤销' : STATUS_LABELS[item.status]
                }
                onPress={canRevoke ? () => confirmRevoke(item) : undefined}
              />
            )
          })
        )}
      </FutureFeatureSection>

      {signedIn && page ? (
        <>
          <FutureFeatureNotice title={`第 ${page.cursors.length} 页 · 本页 ${sessions.length} 条`}>
            每页最多 25 条。重连会产生独立的访问记录，已结束的记录仍可查看。
          </FutureFeatureNotice>
          <FutureFeatureAction
            disabled={loading || revokingId !== null || page.cursors.length <= 1}
            label="上一页"
            onPress={() => void loadPage(page.cursors.slice(0, -1))}
          />
          <FutureFeatureAction
            disabled={loading || revokingId !== null || !page.nextCursor}
            label="下一页"
            onPress={() => {
              if (page.nextCursor) {
                void loadPage([...page.cursors, page.nextCursor])
              }
            }}
          />
        </>
      ) : null}

      <FutureFeatureAction
        disabled={!signedIn || loading || revokingId !== null}
        label="刷新会话"
        loading={loading}
        onPress={() => void loadPage(page?.cursors ?? [null])}
      />
    </FutureFeatureScreen>
  )
}

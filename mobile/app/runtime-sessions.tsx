import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
import { useCallback, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
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
  const t = useMobileTranslation()

  const params = useLocalSearchParams<{ runtimeRecordId?: string }>()
  const runtimeRecordId = typeof params.runtimeRecordId === 'string' ? params.runtimeRecordId : null
  const { hydrated, session: accountSession } = useMobileAuthSession()
  const { listSessions, revokeSession } = useAccountRuntimeDirectory()
  const scopeKey = accountSession
    ? JSON.stringify([
        accountSession.authorityId,
        accountSession.account.accountId,
        runtimeRecordId
      ])
    : null
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  const generationRef = useRef(0)
  const revokeOperationRef = useRef(0)
  const [loaded, setLoaded] = useState<ScopedSessions | null>(null)
  const [loadingScope, setLoadingScope] = useState<string | null>(null)
  const [scopedError, setScopedError] = useState<ScopedError | null>(null)
  const [revokeOperation, setRevokeOperation] = useState<RevokeOperation | null>(null)
  const sessions =
    loaded?.scopeKey === scopeKey
      ? loaded.items.filter((item) => !runtimeRecordId || item.runtimeRecordId === runtimeRecordId)
      : []
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
            message: t(
              'auto.mobile.app.runtime.sessions.2b51e265d4',
              'Could not read Runtime sessions. Try again later.'
            )
          })
        }
      } finally {
        if (generation === generationRef.current && scopeRef.current === requestedScope) {
          setLoadingScope(null)
        }
      }
    },
    [listSessions, scopeKey, t]
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
          Alert.alert(
            t('auto.mobile.app.runtime.sessions.177a74b0f7', 'Could not revoke session'),
            t(
              'auto.mobile.app.runtime.sessions.b4ace88a90',
              'Could not revoke this Runtime session. Refresh and try again.'
            )
          )
        }
      } finally {
        setRevokeOperation((current) => (current?.operationId === operationId ? null : current))
      }
    },
    [revokeSession, t]
  )

  const confirmRevoke = useCallback(
    (target: RuntimeSession) => {
      const requestedScope = scopeRef.current
      if (!requestedScope) {
        return
      }
      Alert.alert(
        t('auto.mobile.app.runtime.sessions.30277d9b05', 'Revoke Runtime session?'),
        t(
          'auto.mobile.app.runtime.sessions.54c85e1666',
          'This client will immediately lose account access. Local QR pairings and local credentials will remain.'
        ),
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
    [revoke, t]
  )

  const signedIn = hydrated && scopeKey !== null
  return (
    <FutureFeatureScreen
      capabilityId="account"
      title={t('auto.mobile.app.runtime.sessions.c0b479171e', 'Runtime sessions')}
      description={
        runtimeRecordId
          ? t(
              'auto.mobile.app.runtime.sessions.8b3023af8b',
              'View this runtime environment’s access sessions on the web, computers, and phones, and revoke sessions you no longer use.'
            )
          : t(
              'auto.mobile.app.runtime.sessions.c990a45e97',
              'View the current account’s Runtime access sessions on the web, computers, and phones, and force-revoke sessions you no longer use.'
            )
      }
    >
      <FutureFeatureNotice
        title={
          signedIn
            ? t('auto.mobile.app.runtime.sessions.5b1d62c6ad', 'Account sessions')
            : t('auto.mobile.app.runtime.sessions.d9113519c3', 'Sign in first')
        }
      >
        {signedIn
          ? t(
              'auto.mobile.app.runtime.sessions.75fb69c3a4',
              'Revocation affects account cloud access only. Anonymous local pairings remain independent.'
            )
          : t(
              'auto.mobile.app.runtime.sessions.9d7f4b4194',
              'Sign in to view and revoke Runtime sessions.'
            )}
      </FutureFeatureNotice>

      <FutureFeatureSection
        title={t('auto.mobile.app.runtime.sessions.897f77ddf0', 'Session list')}
      >
        {!signedIn ? (
          <FutureFeatureRow
            label={t('auto.mobile.app.runtime.sessions.c0b479171e', 'Runtime sessions')}
            value="未登录"
          />
        ) : error ? (
          <FutureFeatureRow
            detail={error}
            label={t('auto.mobile.app.runtime.sessions.81dfe211c3', 'Could not load')}
            value="可重试"
          />
        ) : loading && sessions.length === 0 ? (
          <FutureFeatureRow
            label={t('auto.mobile.app.runtime.sessions.c0b479171e', 'Runtime sessions')}
            value="读取中"
          />
        ) : sessions.length === 0 ? (
          <FutureFeatureRow
            label={t('auto.mobile.app.runtime.sessions.c0b479171e', 'Runtime sessions')}
            value={runtimeRecordId ? '本页暂无此运行环境的会话' : '暂无会话'}
          />
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
          <FutureFeatureNotice
            title={t(
              'auto.mobile.app.runtime.sessions.24f4fff0bd',
              'Page {{value0}} · records on this page: {{value1}}',
              { value0: page.cursors.length, value1: sessions.length }
            )}
          >
            {t(
              'auto.mobile.app.runtime.sessions.b8debcc981',
              'Up to 25 records per page. Reconnecting creates a separate access record. Ended sessions remain available to view.'
            )}
            {runtimeRecordId
              ? t(
                  'auto.mobile.app.runtime.sessions.94f48cf381',
                  'Filter this page’s account sessions by the current runtime environment. Go to the next page to see more.'
                )
              : null}
          </FutureFeatureNotice>
          <FutureFeatureAction
            disabled={loading || revokingId !== null || page.cursors.length <= 1}
            label={t('auto.mobile.app.runtime.sessions.1ddf333095', 'Previous page')}
            onPress={() => void loadPage(page.cursors.slice(0, -1))}
          />
          <FutureFeatureAction
            disabled={loading || revokingId !== null || !page.nextCursor}
            label={t('auto.mobile.app.runtime.sessions.e01877fa61', 'Next page')}
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
        label={t('auto.mobile.app.runtime.sessions.c50befd860', 'Refresh sessions')}
        loading={loading}
        onPress={() => void loadPage(page?.cursors ?? [null])}
      />
    </FutureFeatureScreen>
  )
}

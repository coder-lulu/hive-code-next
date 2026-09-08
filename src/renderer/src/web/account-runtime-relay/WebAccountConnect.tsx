import { translate } from '../../i18n/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  WebAccountSession,
  WEB_ACCOUNT_LOGIN_PATH,
  requestedWebRuntime,
  canConnectWebRuntime,
  type WebAccountRuntime
} from './web-account-session'
import {
  createWebAccountRelayClient,
  type WebAccountRuntimeClient
} from './web-account-relay-client'
import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'

export type WebAccountBootstrap = {
  runtime: WebAccountRuntime
  session: WebAccountSession
  client: WebAccountRuntimeClient
}

export function accountRuntimeEnvironment(runtime: WebAccountRuntime): StoredWebRuntimeEnvironment {
  const now = Date.now()
  return {
    id: `account-${runtime.runtimeRecordId}`,
    name: runtime.cloudDisplayName || runtime.deviceName || translate('auto.web.WebAccountConnect.runtimeName', 'Hive Runtime'),
    runtimeId: null,
    runtimeRecordId: runtime.runtimeRecordId,
    preferredEndpointId: `account-${runtime.runtimeRecordId}`,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    endpoints: []
  }
}

export default function WebAccountConnect({
  onConnected,
  children
}: {
  onConnected: (bootstrap: WebAccountBootstrap) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const [session] = useState(() => new WebAccountSession())
  const [runtimes, setRuntimes] = useState<WebAccountRuntime[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const connected = useRef(false)
  const pendingClient = useRef<WebAccountRuntimeClient | null>(null)
  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])
  const [target] = useState(() => {
    try {
      return { id: requestedWebRuntime(window.location.search), error: '' }
    } catch (error) {
      return { id: null, error: (error as Error).message }
    }
  })
  const loginPath = target.id
    ? `/login?redirect=${encodeURIComponent(`/runtime/?runtime=${target.id}`)}`
    : WEB_ACCOUNT_LOGIN_PATH

  const connect = useCallback(
    async (runtime: WebAccountRuntime) => {
      setBusy(true)
      setError('')
      const client = createWebAccountRelayClient(() => session.material(runtime))
      pendingClient.current = client
      try {
        const status = await client.call('status.get', undefined, { timeoutMs: 15_000 })
        if (!status.ok) {
          throw new Error('Runtime unavailable')
        }
        connected.current = true
        onConnectedRef.current({ runtime, session, client })
      } catch {
        setError('连接失败，请刷新电脑列表后重试。')
      } finally {
        if (!connected.current) {
          client.close()
        }
        setBusy(false)
      }
    },
    [session]
  )

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const authenticated = await session.restore()
        if (!active) {
          return
        }
        setSignedIn(authenticated)
        if (!authenticated) {
          return
        }
        if (target.error) {
          setError(target.error)
          return
        }
        if (target.id) {
          const runtime = await session.runtime(target.id)
          if (!active) {
            return
          }
          setRuntimes([runtime])
          if (!canConnectWebRuntime(runtime)) {
            setError('这台电脑当前没有可用连接路径，请确认电脑在线后重试。')
            return
          }
          await connect(runtime)
          return
        }
        const page = await session.runtimes()
        if (active) {
          setRuntimes(page.items)
          setCursor(page.nextCursor)
        }
      } catch {
        if (active) {
          setError(
            target.id
              ? '无法加载这台电脑，请确认仍在当前账户中，或刷新后重试。'
              : '账户服务暂时不可用，请重新登录或重试。'
          )
        }
      } finally {
        if (active) {
          setBusy(false)
        }
      }
    }
    void restore()
    return () => {
      active = false
      if (!connected.current) {
        pendingClient.current?.close()
        pendingClient.current = null
        session.close()
      }
    }
  }, [session, connect, target.id, target.error])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <section className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <h1 className="text-base font-semibold">{translate('auto.web.WebAccountConnect.title', 'Connect to your computers')}</h1>
        <p className="text-sm text-muted-foreground">{translate('auto.web.WebAccountConnect.description', 'Connect to your computer Runtime with your HiveCloud account.')}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            {translate('auto.web.WebAccountConnect.connecting', 'Connecting…')}
          </p>
        )}
        {!signedIn && !busy && (
          <Button asChild>
            <a href={loginPath}>{translate('auto.web.WebAccountConnect.signIn', 'Sign in to HiveCloud')}</a>
          </Button>
        )}
        {signedIn && (
          <div className="divide-y divide-border">
            {runtimes.map((runtime) => (
              <div
                key={runtime.runtimeRecordId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0 truncate text-sm">
                  {runtime.cloudDisplayName || runtime.deviceName || translate('auto.web.WebAccountConnect.runtimeName', 'Hive Runtime')}
                </span>
                <Button
                  variant="outline"
                  disabled={busy || !canConnectWebRuntime(runtime)}
                  onClick={() => void connect(runtime)}
                >
                  {translate('auto.web.WebAccountConnect.connect', 'Connect')}
                </Button>
              </div>
            ))}
            {!runtimes.length && !busy && (
              <p className="py-3 text-sm text-muted-foreground">{translate('auto.web.WebAccountConnect.empty', 'No claimed computers in this account.')}</p>
            )}
          </div>
        )}
        {cursor && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void session
                .runtimes(cursor)
                .then((page) => {
                  setRuntimes(page.items)
                  setCursor(page.nextCursor)
                })
                .catch(() => setError('无法加载电脑列表。'))
                .finally(() => setBusy(false))
            }}
          >
            {translate('auto.web.WebAccountConnect.nextPage', 'Next page')}
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => window.location.reload()}>
          {translate('auto.web.WebAccountConnect.refresh', 'Refresh')}
        </Button>
        {children}
      </section>
    </main>
  )
}

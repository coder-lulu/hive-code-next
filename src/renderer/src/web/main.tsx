import '../assets/main.css'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import WebConnect from './WebConnect'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  clearPairingInputFromAddressBar,
  decideWebPairingStartup,
  readPairingInputFromLocation
} from './web-pairing'
import {
  createStoredWebRuntimeEnvironment,
  readStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from './web-runtime-environment'
import { installWebPreloadApi, closeActiveRuntimeClients } from './web-preload-api'
import { I18nProvider } from '../i18n/I18nProvider'
import { translate } from '../i18n/i18n'
import { APP_DISPLAY_NAME } from '../product-brand'
import {
  clearCloudLaunchCredentialFromAddressBar,
  readCloudLaunchFragment,
  type CloudLaunchCredential
} from './cloud-launch-fragment'
import { exchangeCloudLaunchCredential, type CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import WebAccountConnect, {
  type WebAccountBootstrap
} from './account-runtime-relay/WebAccountConnect'

import { useWebRuntimeDisplayMetadata } from './use-web-runtime-display-metadata'
import {
  captureWebRuntimeDisplayOwner,
  clearWebRuntimeDisplayProjection
} from './preload-api/web-runtime-session'

const reloadAccountPage = (): void => window.location.reload()

document.title = `${APP_DISPLAY_NAME} Web`
import { installOsFileDropCancellationGuard } from '../lib/os-file-drop-cancellation-guard'

const disposeOsFileDropGuard = installOsFileDropCancellationGuard()
import.meta.hot?.dispose(disposeOsFileDropGuard)
const App = lazy(() => import('../App'))
const initialCloudLaunch = readCloudLaunchFragment(window.location)
if (initialCloudLaunch.kind !== 'absent') {
  clearCloudLaunchCredentialFromAddressBar()
}

function WebRoot(): React.JSX.Element {
  if (window.location.pathname === '/runtime/' || window.location.pathname === '/runtime') {
    return <AccountRuntimeRoot />
  }
  return <PairedWebRoot />
}

function AccountRuntimeRoot(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<WebAccountBootstrap | null>(null)
  useEffect(() => {
    if (!bootstrap || typeof BroadcastChannel === 'undefined') {
      return
    }
    const channel = new BroadcastChannel('hivecloud:user-auth')
    channel.onmessage = (event) => {
      if (event.data?.type === 'signed-out' || event.data?.type === 'session-expired') {
        const owner = captureWebRuntimeDisplayOwner()
        if (owner) {
          clearWebRuntimeDisplayProjection(owner)
        }
        closeActiveRuntimeClients()
        bootstrap.session.close()
        window.location.reload()
      }
    }
    return () => {
      channel.onmessage = null
      channel.close()
    }
  }, [bootstrap])
  const metadataState = useWebRuntimeDisplayMetadata(
    bootstrap,
    null,
    closeActiveRuntimeClients,
    reloadAccountPage
  )
  if (!bootstrap) {
    return (
      <WebAccountConnect
        onConnected={(value) => {
          installWebPreloadApi(undefined, value)
          setBootstrap(value)
        }}
      />
    )
  }
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <RuntimeMetadataSyncNotice state={metadataState} />
      <App />
    </Suspense>
  )
}

function PairedWebRoot(): React.JSX.Element {
  const initialPairingInput = useMemo(() => readPairingInputFromLocation(window.location), [])
  // Why: current runtime links carry scope metadata. Runtime-scope offers keep
  // the instant save path; mobile/legacy-unknown offers must be shown/probed.
  const startupDecision = useMemo(() => {
    const decision = decideWebPairingStartup({
      initialPairingInput,
      hasStoredEnvironment: readStoredWebRuntimeEnvironment() !== null
    })
    if (
      decision.kind === 'auto-save-runtime-offer' ||
      (decision.kind === 'show-connect' && decision.initialPairingInput !== null)
    ) {
      clearPairingInputFromAddressBar()
    }
    return decision
  }, [initialPairingInput])
  const [hasEnvironment, setHasEnvironment] = useState(() => {
    if (startupDecision.kind === 'auto-save-runtime-offer') {
      saveStoredWebRuntimeEnvironment(
        createStoredWebRuntimeEnvironment({
          name: `${APP_DISPLAY_NAME} Server`,
          offer: startupDecision.offer,
          previousEnvironment: readStoredWebRuntimeEnvironment()
        })
      )
      return true
    }
    return startupDecision.kind === 'use-stored-environment'
  })

  if (initialCloudLaunch.kind === 'invalid') {
    return <CloudLaunchFailure />
  }
  if (initialCloudLaunch.kind === 'valid') {
    return <CloudLaunchRoot credential={initialCloudLaunch.credential} />
  }

  if (!hasEnvironment) {
    return (
      <WebConnect
        initialPairingInput={
          startupDecision.kind === 'show-connect' ? startupDecision.initialPairingInput : null
        }
        onConnected={() => setHasEnvironment(true)}
      />
    )
  }

  installWebPreloadApi()
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <App />
    </Suspense>
  )
}

function CloudLaunchRoot({ credential }: { credential: CloudLaunchCredential }): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<CloudLaunchBootstrap | null>(null)
  const [failed, setFailed] = useState(false)
  const metadataState = useWebRuntimeDisplayMetadata(
    null,
    bootstrap,
    closeActiveRuntimeClients,
    reloadAccountPage
  )

  useEffect(() => {
    let active = true
    void exchangeCloudLaunchCredential(credential)
      .then((result) => {
        if (!active) {
          return
        }
        installWebPreloadApi(result)
        setBootstrap(result)
      })
      .catch(() => {
        if (active) {
          setFailed(true)
        }
      })
    return () => {
      active = false
    }
  }, [credential])

  if (failed || metadataState === 'expired') {
    return <CloudLaunchFailure />
  }
  if (!bootstrap) {
    return <div className="min-h-dvh bg-background" />
  }
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <RuntimeMetadataSyncNotice state={metadataState} />
      <App />
    </Suspense>
  )
}

function RuntimeMetadataSyncNotice({ state }: { state: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (state !== 'unverifiable') {
    return null
  }
  return (
    <div
      role="status"
      className="fixed inset-x-2 bottom-2 z-50 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm sm:inset-x-auto sm:left-3 sm:max-w-lg"
    >
      {t('web.runtime.nameSyncUnverified', '名称同步暂不可验证，显示上次已确认名称。')}
    </div>
  )
}

function CloudLaunchFailure(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <p>
        {translate(
          'web.cloudLaunchFailure',
          'This Cloud launch link is invalid or has expired. Create a new launch from HiveCloud.'
        )}
      </p>
    </main>
  )
}

function WebRootBoundary(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="web.root"
      surface="web-root"
      title={translate('app.recoverableError.webTitle', 'Orca web hit a renderer error.')}
      description={translate(
        'app.recoverableError.webDescription',
        'Retry the web client or reconnect to the paired runtime.'
      )}
    >
      <WebRoot />
    </RecoverableRenderErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <I18nProvider>
    <WebRootBoundary />
  </I18nProvider>
)

// Why: the web client is its own entry point and hosts terminals too, so it has
// to start the deferred WebGL addon load itself (see main.tsx). Dynamic because
// this entry deliberately keeps the whole App graph — pane manager included —
// out of its own startup chunk.
void import('../lib/pane-manager/pane-webgl-renderer').then((module) =>
  module.primeTerminalWebglAddon()
)

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../../store'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getPairedMobileDevicesSnapshot,
  usePairedMobileDevices
} from '../mobile/paired-mobile-devices'
import { useMobilePairingDevicePolling } from './mobile-pairing-device-polling'
import type { MobileNetworkInterface } from './mobile-network-interface-selection'
import { MachineNameField } from './MachineNameField'
import { MobilePairingQrSection } from './MobilePairingQrSection'
import { MobilePairingSetupSection } from './MobilePairingSetupSection'
import { WindowsFirewallNotice } from '../mobile/WindowsFirewallNotice'
import { translate } from '@/i18n/i18n'
import { useMobilePairingAddressPreference } from '../mobile/use-mobile-pairing-address-preference'
import type { MobilePairingAddressChange } from '../mobile/use-mobile-pairing-address-preference'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
export { getMobilePaneSearchEntries } from './mobile-pane-search'

export function MobilePane({
  cloudConnection,
  directConnection,
  active = true,
  requestedConnectionMethod,
  navigationRevision
}: {
  cloudConnection?: ReactNode
  directConnection?: ReactNode
  active?: boolean
  requestedConnectionMethod?: 'cloud' | 'direct'
  navigationRevision?: number
}): React.JSX.Element {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrSize, setQrSize] = useState<number | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [qrEnlarged, setQrEnlarged] = useState(false)
  const [networkInterfaces, setNetworkInterfaces] = useState<MobileNetworkInterface[]>([])
  const [refreshingNetworkInterfaces, setRefreshingNetworkInterfaces] = useState(false)
  const [addressDiscoverySettled, setAddressDiscoverySettled] = useState(false)
  const [validatingCustomAddress, setValidatingCustomAddress] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [deviceCountAtQr, setDeviceCountAtQr] = useState<number | null>(null)
  const [rotateNextQr, setRotateNextQr] = useState(false)
  const methodRequest = requestedConnectionMethod
    ? `${requestedConnectionMethod}:${navigationRevision ?? 0}`
    : null
  const [methodSelection, setMethodSelection] = useState(() => ({
    request: methodRequest,
    value: requestedConnectionMethod ?? (cloudConnection ? 'cloud' : 'direct')
  }))
  if (methodRequest !== methodSelection.request) {
    setMethodSelection({
      request: methodRequest,
      value: requestedConnectionMethod ?? methodSelection.value
    })
  }
  const connectionMethod = methodSelection.value
  const setConnectionMethod = (value: string): void => {
    if (value === 'cloud' || value === 'direct') {
      setMethodSelection((current) => ({ ...current, value }))
    }
  }
  const codeCopiedResetTimerRef = useRef<number | null>(null)
  // Address changes invalidate pending QR responses.
  const pairingRequestIdRef = useRef(0)
  const networkInterfacesRequestIdRef = useRef(0)
  const customAddressRequestIdRef = useRef(0)
  // Ref mirrors of QR-visible / loading so invalidatePairing stays stable and
  // cannot make loadNetworkInterfaces re-fetch on every generate.
  const credentialAvailableRef = useRef(false)
  const loadingRef = useRef(false)
  const mountedRef = useMountedRef()
  const cancelAddressRequests = useCallback((): void => {
    customAddressRequestIdRef.current += 1
    networkInterfacesRequestIdRef.current += 1
    setValidatingCustomAddress(false)
    setRefreshingNetworkInterfaces(false)
    setAddressDiscoverySettled(true)
  }, [])
  const {
    devices,
    loaded: devicesLoaded,
    refresh: refreshDevices
  } = usePairedMobileDevices({ refreshOnMount: false })

  useEffect(() => {
    credentialAvailableRef.current = pairingUrl != null
  }, [pairingUrl])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  // Why: an offer encodes a specific endpoint. When the selection that
  // produced it changes, drop any displayed QR and invalidate the in-flight
  // request so a late response can't restore it; arm rotation so the next mint
  // issues a fresh credential rather than the discarded pending one.
  const invalidatePairing = useCallback((): void => {
    pairingRequestIdRef.current += 1
    const hadPending = credentialAvailableRef.current || loadingRef.current
    setQrDataUrl(null)
    setQrSize(null)
    setPairingUrl(null)
    setQrError(false)
    setEndpoint(null)
    // Why: a superseded in-flight generate no longer clears loading in its
    // finally (the epoch bump skips it), so drop the spinner here or Generate
    // stays disabled forever after a mid-flight address change.
    loadingRef.current = false
    setLoading(false)
    if (hadPending) {
      setRotateNextQr(true)
    }
  }, [])
  const invalidatePairingAddress = useCallback(
    (change: MobilePairingAddressChange) => {
      if (change.source !== 'refresh') {
        cancelAddressRequests()
      } else {
        customAddressRequestIdRef.current += 1
        setValidatingCustomAddress(false)
      }
      invalidatePairing()
    },
    [cancelAddressRequests, invalidatePairing]
  )
  const {
    selectedAddress,
    selectedAddressIsCustom,
    customAddresses,
    selectAddress: handleSelectedAddressChange,
    selectCustomAddress,
    removeCustomAddress: handleCustomAddressRemove,
    selectAddressAfterRefresh
  } = useMobilePairingAddressPreference({
    networkInterfaces,
    onSelectionInvalidated: invalidatePairingAddress
  })

  const clearCodeCopiedResetTimer = useCallback((): void => {
    if (codeCopiedResetTimerRef.current !== null) {
      window.clearTimeout(codeCopiedResetTimerRef.current)
      codeCopiedResetTimerRef.current = null
    }
  }, [])

  const beforeCustomAddressChange = useCallback(
    async (address: string): Promise<boolean> => {
      if (address === selectedAddress) {
        return true
      }
      const requestId = ++customAddressRequestIdRef.current
      setValidatingCustomAddress(true)
      try {
        const result = await window.api.mobile.getPairingQR({ address })
        if (!mountedRef.current || requestId !== customAddressRequestIdRef.current) {
          return false
        }
        if (!result.available || result.qrDataUrl === null) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.e3c427e020',
              'Failed to generate QR code'
            )
          )
          return false
        }
        setRotateNextQr(true)
        return true
      } catch {
        if (mountedRef.current && requestId === customAddressRequestIdRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.e3c427e020',
              'Failed to generate QR code'
            )
          )
        }
        return false
      } finally {
        if (mountedRef.current && requestId === customAddressRequestIdRef.current) {
          setValidatingCustomAddress(false)
        }
      }
    },
    [mountedRef, selectedAddress]
  )

  const loadDevices = useCallback(async () => {
    try {
      await refreshDevices()
    } catch {
      // Silently fail — device list is non-critical
    }
  }, [refreshDevices])

  const loadNetworkInterfaces = useCallback(
    async (opts: { notifyOnError?: boolean } = {}) => {
      const requestId = ++networkInterfacesRequestIdRef.current
      setRefreshingNetworkInterfaces(true)
      try {
        const result = await window.api.mobile.listNetworkInterfaces()
        if (mountedRef.current && requestId === networkInterfacesRequestIdRef.current) {
          setNetworkInterfaces(result.interfaces)
          selectAddressAfterRefresh(result.interfaces)
        }
      } catch {
        if (
          opts.notifyOnError &&
          mountedRef.current &&
          requestId === networkInterfacesRequestIdRef.current
        ) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.d714614dbf',
              'Failed to refresh network interfaces'
            )
          )
        }
      } finally {
        if (mountedRef.current && requestId === networkInterfacesRequestIdRef.current) {
          setAddressDiscoverySettled(true)
          setRefreshingNetworkInterfaces(false)
        }
      }
    },
    [mountedRef, selectAddressAfterRefresh]
  )

  const generateQR = useCallback(
    async (
      opts: {
        rotate?: boolean
      } = {}
    ) => {
      if (!addressDiscoverySettled || refreshingNetworkInterfaces || validatingCustomAddress) {
        return
      }
      const requestId = ++pairingRequestIdRef.current
      loadingRef.current = true
      setLoading(true)
      setQrError(false)
      try {
        const result = await window.api.mobile.getPairingQR({
          ...(selectedAddress ? { address: selectedAddress } : {}),
          ...(opts.rotate || rotateNextQr ? { rotate: true } : {})
        })
        // Why: an address change bumps the epoch.
        // A response for a superseded request must not paint a QR that no
        // longer matches the current selection.
        if (!mountedRef.current || requestId !== pairingRequestIdRef.current) {
          return
        }
        if (result.available) {
          useAppStore.getState().recordFeatureInteraction('mobile-pairing')
          if (mountedRef.current) {
            setQrDataUrl(result.qrDataUrl)
            setQrSize(result.qrSize)
            setPairingUrl(result.pairingUrl)
            setQrError(result.qrDataUrl === null)
            setEndpoint(result.endpoint)
            setDeviceCountAtQr(getPairedMobileDevicesSnapshot().length)
            clearCodeCopiedResetTimer()
            setCodeCopied(false)
            setRotateNextQr(false)
            void loadDevices()
          }
        } else if (mountedRef.current) {
          setQrDataUrl(null)
          setQrSize(null)
          setPairingUrl(null)
          setQrError(false)
          setEndpoint(null)
          toast.error(
            result.guidance ??
              translate(
                'auto.components.settings.MobilePane.cb9067c1c1',
                'WebSocket transport is not running'
              )
          )
        }
      } catch {
        if (mountedRef.current && requestId === pairingRequestIdRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.e3c427e020',
              'Failed to generate QR code'
            )
          )
        }
      } finally {
        if (mountedRef.current && requestId === pairingRequestIdRef.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [
      addressDiscoverySettled,
      refreshingNetworkInterfaces,
      validatingCustomAddress,
      clearCodeCopiedResetTimer,
      loadDevices,
      mountedRef,
      rotateNextQr,
      selectedAddress
    ]
  )

  useEffect(
    () => () => {
      pairingRequestIdRef.current += 1
      networkInterfacesRequestIdRef.current += 1
      customAddressRequestIdRef.current += 1
    },
    []
  )

  useEffect(() => {
    void loadNetworkInterfaces()
  }, [loadNetworkInterfaces])

  // Why: another surface (e.g. the sidebar) may have already populated the
  // shared cache; only fetch on mount when it hasn't loaded yet.
  useEffect(() => {
    if (!devicesLoaded) {
      void loadDevices()
    }
  }, [devicesLoaded, loadDevices])

  useMobilePairingDevicePolling({
    deviceCountAtQr: active && connectionMethod === 'direct' ? deviceCountAtQr : null,
    currentDeviceCount: devices.length,
    loadDevices
  })

  return (
    <div className="space-y-6">
      <MachineNameField id="mobile-machine-name" />
      <Tabs value={connectionMethod} onValueChange={setConnectionMethod} className="gap-4">
        {cloudConnection ? (
          <TabsList
            className="w-full sm:w-fit"
            aria-label={translate('phoneConnection.method', 'Connection method')}
          >
            <TabsTrigger value="cloud">
              {translate('phoneConnection.cloud', 'HiveCloud account')}
            </TabsTrigger>
            <TabsTrigger value="direct">
              {translate('phoneConnection.direct', 'Direct address')}
            </TabsTrigger>
          </TabsList>
        ) : null}
        {cloudConnection ? (
          <TabsContent value="cloud" forceMount className="data-[state=inactive]:hidden">
            {cloudConnection}
          </TabsContent>
        ) : null}
        <TabsContent
          value="direct"
          forceMount
          className="space-y-6 rounded-xl border border-border/60 bg-card p-5 data-[state=inactive]:hidden"
        >
          <MobilePairingSetupSection
            networkInterfaces={networkInterfaces}
            customAddresses={customAddresses}
            selectedAddress={selectedAddress}
            selectedAddressIsCustom={selectedAddressIsCustom}
            onSelectedAddressChange={(address) => {
              cancelAddressRequests()
              handleSelectedAddressChange(address)
            }}
            onCustomAddressSelect={selectCustomAddress}
            beforeCustomAddressChange={beforeCustomAddressChange}
            onCustomAddressRemove={handleCustomAddressRemove}
            refreshingNetworkInterfaces={refreshingNetworkInterfaces}
            onRefreshNetworkInterfaces={() => void loadNetworkInterfaces({ notifyOnError: true })}
            loading={loading}
            canGenerate={
              addressDiscoverySettled && !refreshingNetworkInterfaces && !validatingCustomAddress
            }
            hasQrCode={pairingUrl != null}
            onGenerateQr={() => void generateQR({ rotate: pairingUrl != null })}
          />

          <span className="sr-only" role="status" aria-live="polite">
            {pairingUrl != null && !loading
              ? translate(
                  'auto.components.settings.MobilePane.pairingCodeReady',
                  'Pairing code ready'
                )
              : ''}
          </span>

          <MobilePairingQrSection
            active={active && connectionMethod === 'direct'}
            qrDataUrl={qrDataUrl}
            qrSize={qrSize}
            qrError={qrError}
            pairingUrl={pairingUrl}
            endpoint={endpoint}
            qrEnlarged={qrEnlarged}
            codeCopied={codeCopied}
            onQrEnlargedChange={setQrEnlarged}
            onCodeCopiedChange={setCodeCopied}
            onClearCodeCopiedTimer={clearCodeCopiedResetTimer}
          />

          <WindowsFirewallNotice pairingReady={pairingUrl != null} address={selectedAddress} />
          {directConnection}
        </TabsContent>
      </Tabs>
    </div>
  )
}

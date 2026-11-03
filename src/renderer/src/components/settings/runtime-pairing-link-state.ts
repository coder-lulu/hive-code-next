import { useSyncExternalStore } from 'react'
import type { RuntimePairingReach } from '../../../../shared/runtime-pairing-reach'

export const RUNTIME_PAIRING_LOOPBACK_ADDRESS = '127.0.0.1'

export type RuntimePairingIntent = 'another' | 'local' | 'custom'

// Only explicit local intent forbids network reach; custom loopback addresses may front SSH/reverse-proxy tunnels.
export function runtimePairingReachForIntent(intent: RuntimePairingIntent): RuntimePairingReach {
  return intent === 'local' ? 'this-computer' : 'network'
}

export type RuntimePairingUrlGeneratorProps = {
  framed?: boolean
  showHeader?: boolean
  showGeneratorForm?: boolean
  showAccessList?: boolean
  active?: boolean
}

// Main retains pairing tokens; cache navigation state without persisting credential material.
export const runtimePairingLinkCache: {
  selectedAddress: string
  customAddress: string
  intent: RuntimePairingIntent
  generatedAddress: string | null
  runtimePairingUrl: string | null
  webClientUrl: string | null
  runtimePairingDeviceId: string | null
} = {
  selectedAddress: '',
  customAddress: '',
  intent: 'another',
  generatedAddress: null,
  runtimePairingUrl: null,
  webClientUrl: null,
  runtimePairingDeviceId: null
}

type GeneratedRuntimePairingLink = Pick<
  typeof runtimePairingLinkCache,
  'generatedAddress' | 'runtimePairingUrl' | 'webClientUrl' | 'runtimePairingDeviceId'
>

let generatedLinkSnapshot: GeneratedRuntimePairingLink | null = null
const generatedLinkListeners = new Set<() => void>()

function getGeneratedLinkSnapshot(): GeneratedRuntimePairingLink {
  const { generatedAddress, runtimePairingUrl, webClientUrl, runtimePairingDeviceId } =
    runtimePairingLinkCache
  if (
    !generatedLinkSnapshot ||
    generatedLinkSnapshot.generatedAddress !== generatedAddress ||
    generatedLinkSnapshot.runtimePairingUrl !== runtimePairingUrl ||
    generatedLinkSnapshot.webClientUrl !== webClientUrl ||
    generatedLinkSnapshot.runtimePairingDeviceId !== runtimePairingDeviceId
  ) {
    generatedLinkSnapshot = {
      generatedAddress,
      runtimePairingUrl,
      webClientUrl,
      runtimePairingDeviceId
    }
  }
  return generatedLinkSnapshot
}

function subscribeGeneratedLink(listener: () => void): () => void {
  generatedLinkListeners.add(listener)
  return () => {
    generatedLinkListeners.delete(listener)
  }
}

export function useGeneratedRuntimePairingLink(): GeneratedRuntimePairingLink {
  return useSyncExternalStore(
    subscribeGeneratedLink,
    getGeneratedLinkSnapshot,
    getGeneratedLinkSnapshot
  )
}

function publishGeneratedLink(): void {
  for (const listener of generatedLinkListeners) {
    listener()
  }
}

export function clearGeneratedRuntimePairingLink(deviceId?: string): void {
  // A delayed revoke must not clear a link generated for a different grant.
  if (deviceId !== undefined && runtimePairingLinkCache.runtimePairingDeviceId !== deviceId) {
    return
  }
  runtimePairingLinkCache.runtimePairingUrl = null
  runtimePairingLinkCache.webClientUrl = null
  runtimePairingLinkCache.runtimePairingDeviceId = null
  runtimePairingLinkCache.generatedAddress = null
  publishGeneratedLink()
}

export function cacheGeneratedRuntimePairingLink(args: {
  address: string
  pairingUrl: string
  webClientUrl: string | null
  deviceId: string
}): void {
  runtimePairingLinkCache.runtimePairingUrl = args.pairingUrl
  runtimePairingLinkCache.webClientUrl = args.webClientUrl
  runtimePairingLinkCache.runtimePairingDeviceId = args.deviceId
  runtimePairingLinkCache.generatedAddress = args.address
  publishGeneratedLink()
}

export function selectRuntimePairingIntent(
  intent: RuntimePairingIntent,
  networkInterfaces: { address: string }[],
  customAddress: string
): string {
  runtimePairingLinkCache.intent = intent
  const selectedAddress =
    intent === 'local'
      ? RUNTIME_PAIRING_LOOPBACK_ADDRESS
      : intent === 'another'
        ? (networkInterfaces[0]?.address ?? '')
        : customAddress
  runtimePairingLinkCache.selectedAddress = selectedAddress
  return selectedAddress
}

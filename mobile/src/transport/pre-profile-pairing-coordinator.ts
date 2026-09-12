import { requireRpcResultOrThrowCodedError } from './rpc-acceptance-policies'
import { connect, type ConnectOptions, type RpcClient } from './rpc-client'
import { resolvePairingHostIdentity, saveHost } from './host-store'
import type { HostProfile, PairingOffer } from './types'
import { offerWithAuthenticatedRuntimeRecordId } from './authenticated-runtime-pairing-offer'

export type PreProfilePairingAttempt = {
  readonly result: Promise<{ hostId: string }>
  readonly timedOut: boolean
  dispose(): void
}

type Dependencies = {
  connectDirect: typeof connect
  resolveHostIdentity: typeof resolvePairingHostIdentity
  saveHost: typeof saveHost
  now: () => number
}
const defaultDependencies: Dependencies = {
  connectDirect: connect,
  resolveHostIdentity: resolvePairingHostIdentity,
  saveHost,
  now: Date.now
}

export function startPreProfilePairing(args: {
  offer: PairingOffer
  timeoutMs: number
  connectOptions?: ConnectOptions
  dependencies?: Partial<Dependencies>
}): PreProfilePairingAttempt {
  const dependencies = { ...defaultDependencies, ...args.dependencies }
  const clients = new Set<RpcClient>()
  let disposed = false
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    for (const client of clients) {
      client.close()
    }
    clients.clear()
  }

  timer = setTimeout(() => {
    timedOut = true
    dispose()
  }, args.timeoutMs)

  const result = runPairing(args.offer, args.connectOptions, dependencies, clients, () => disposed)
    .catch((error: unknown) => {
      if (timedOut) {
        throw new Error('mobile pairing timed out')
      }
      throw error
    })
    .finally(() => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      for (const client of clients) {
        client.close()
      }
      clients.clear()
    })

  return {
    result,
    get timedOut() {
      return timedOut
    },
    dispose
  }
}

async function runPairing(
  offer: PairingOffer,
  connectOptions: ConnectOptions | undefined,
  dependencies: Dependencies,
  clients: Set<RpcClient>,
  isDisposed: () => boolean
): Promise<{ hostId: string }> {
  const now = dependencies.now()
  const { id: hostId, name } = await dependencies.resolveHostIdentity(
    offer.publicKeyB64,
    `host-${now}`
  )
  assertActive(isDisposed)
  const client = dependencies.connectDirect(
    offer.endpoint,
    offer.deviceToken,
    offer.publicKeyB64,
    connectOptions
  )
  clients.add(client)
  const response = await client.sendRequest('status.get')
  const status = requireRpcResultOrThrowCodedError(response)
  const authenticated = offerWithAuthenticatedRuntimeRecordId(offer, status)
  assertActive(isDisposed)
  const host: HostProfile = {
    id: hostId,
    name,
    endpoint: offer.endpoint,
    deviceToken: offer.deviceToken,
    publicKeyB64: offer.publicKeyB64,
    lastConnected: now,
    runtimeRecordId: authenticated.runtimeRecordId
  }
  await dependencies.saveHost(host)
  return { hostId }
}
function assertActive(isDisposed: () => boolean): void {
  if (isDisposed()) {
    throw new Error('mobile pairing cancelled')
  }
}

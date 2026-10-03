export type AccountRuntimeClientRegistration = Readonly<{
  hostId: string
  runtimeRecordId: string
  resourceVersion: number
  accessMode: 'account-only' | 'local-fallback'
}>

type RegisteredClient = AccountRuntimeClientRegistration & { readonly lease: object }

const activeClients = new Map<string, RegisteredClient>()

export function registerAccountRuntimeClient(
  registration: AccountRuntimeClientRegistration
): () => void {
  const current = { ...registration, lease: {} }
  activeClients.set(registration.hostId, current)
  return () => {
    if (activeClients.get(registration.hostId)?.lease === current.lease) {
      activeClients.delete(registration.hostId)
    }
  }
}

export function listAccountRuntimeClients(): AccountRuntimeClientRegistration[] {
  return [...activeClients.values()].map(({ lease: _lease, ...registration }) => registration)
}

export function resetAccountRuntimeClientRegistryForTests(): void {
  activeClients.clear()
}

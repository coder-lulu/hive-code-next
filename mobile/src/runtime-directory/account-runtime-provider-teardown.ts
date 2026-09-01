import type { AccountRuntimeClientRegistration } from './account-runtime-client-registry'

export function forgetAccountRuntimeClientsOnProviderUnmount(
  clients: readonly AccountRuntimeClientRegistration[],
  forgetHostClient: (hostId: string) => void
): void {
  for (const client of clients) {
    forgetHostClient(client.hostId)
  }
}

import type { PairingCandidateClient } from './mobile-relay-physical-client'
import type { RpcSuccess } from './types'

export type PairingCandidatePath = 'direct' | 'relay'

export type PairingCandidate = {
  path: PairingCandidatePath
  client: PairingCandidateClient
}

export type AuthenticatedPairingCandidate = PairingCandidate & { status: RpcSuccess }

export function racePairingCandidates(
  candidates: readonly PairingCandidate[]
): Promise<AuthenticatedPairingCandidate> {
  return new Promise((resolve, reject) => {
    const successes: AuthenticatedPairingCandidate[] = []
    let failures = 0
    let settled = false
    let selectionQueued = false
    for (const candidate of candidates) {
      void candidate.client.sendRequest('status.get').then(
        (response) => {
          if (!response.ok) {
            failures++
            rejectIfFinished()
            return
          }
          successes.push({ ...candidate, status: response })
          if (selectionQueued) {
            return
          }
          selectionQueued = true
          // Why: defer one microtask so simultaneous successes are visible and
          // direct deterministically wins the exact tie regardless of callback order.
          queueMicrotask(() => {
            if (settled) {
              return
            }
            settled = true
            const winner = successes.find(({ path }) => path === 'direct') ?? successes[0]!
            for (const loser of candidates) {
              if (loser.client !== winner.client) {
                loser.client.close()
              }
            }
            resolve(winner)
          })
        },
        () => {
          failures++
          rejectIfFinished()
        }
      )
    }

    function rejectIfFinished(): void {
      if (!settled && failures === candidates.length && successes.length === 0) {
        settled = true
        reject(new Error('direct and relay pairing paths both failed'))
      }
    }
  })
}

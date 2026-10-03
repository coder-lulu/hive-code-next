// What the current transport projection says about the desktop, for the host row.
// The retired upstream relay implementation classified close codes here; the product receives
// the already-classified value from its account runtime transport.
export type RelayHostReachability =
  | 'connecting'
  | 'signed-out' // the cell named the desktop account's own sign-out as the reason
  | 'host-offline' // 4404: the cell answered, the desktop is not attached to it
  | 'credential-refused' // 4401 / director 401: this device's relay credential was refused
  | 'unreachable' // 1006: the phone never reached the cell

// A close code cannot identify a signed-out account; that state comes from the
// account runtime's already-classified transport status.
export type RelayHostReachabilityFromCloseCode = Exclude<RelayHostReachability, 'signed-out'>

export function relayHostReachabilityForCloseCode(
  code: number
): RelayHostReachabilityFromCloseCode {
  switch (code) {
    case 4404:
      return 'host-offline'
    case 4401:
      return 'credential-refused'
    case 1006:
      return 'unreachable'
    default:
      return 'connecting'
  }
}

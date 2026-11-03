import type { PairedE2EEFramingPolicy } from '../../../src/shared/paired-e2ee-framing-policy'

// Product direct pairing always requires authenticated v2, including the first dial.
export const AUTHENTICATED_DIRECT_FRAMING_POLICY: PairedE2EEFramingPolicy = {
  framingForNextDial: () => 'v2',
  mayUseLegacy: () => false,
  helloRefusalIsAuthFailure: () => true,
  noteV2Authenticated: () => {},
  noteV2HelloRefused: () => {}
}

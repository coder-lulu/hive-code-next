import { expect, expectTypeOf, it } from 'vitest'
import type { WebPairingOffer } from './web-pairing'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import type { WebRuntimeConnection } from './web-runtime-client-protocol'
import * as WebClient from './web-runtime-client'

type WebRuntimeClientInput = WebPairingOffer | CloudLaunchBootstrap | WebRuntimeConnection

it('keeps the paired-web client public export surface exact', () => {
  expectTypeOf<WebClient.SubscribeOptions>().toEqualTypeOf<WebClient.SubscribeOptions>()
  expectTypeOf<WebClient.WebRuntimeSubscriptionHandle>().toEqualTypeOf<WebClient.WebRuntimeSubscriptionHandle>()
  expectTypeOf<ConstructorParameters<typeof WebClient.WebRuntimeClient>>().toEqualTypeOf<
    [input: WebRuntimeClientInput]
  >()
  expectTypeOf<keyof WebClient.WebRuntimeClient>().toEqualTypeOf<'call' | 'close' | 'subscribe'>()
  expect(Object.keys(WebClient)).toEqual(['WebRuntimeClient'])
})

import { expect, expectTypeOf, it } from 'vitest'
import type { PairedRuntimeConnection } from '../../../shared/paired-runtime-connection'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import type { WebRuntimeTransportConnection } from './web-runtime-transport-connection'
import * as WebClient from './web-runtime-client'

type WebRuntimeClientInput =
  | PairedRuntimeConnection
  | CloudLaunchBootstrap
  | WebRuntimeTransportConnection

it('keeps the paired-web client public export surface exact', () => {
  expectTypeOf<ConstructorParameters<typeof WebClient.WebRuntimeClient>>().toEqualTypeOf<
    [
      input: WebRuntimeClientInput,
      options?: ConstructorParameters<typeof WebClient.WebRuntimeClient>[1]
    ]
  >()
  expectTypeOf<keyof WebClient.WebRuntimeClient>().toEqualTypeOf<
    'call' | 'close' | 'subscribe' | 'statusOwner' | 'connectionEpoch'
  >()
  expect(Object.keys(WebClient)).toEqual(['WebRuntimeClient'])
})

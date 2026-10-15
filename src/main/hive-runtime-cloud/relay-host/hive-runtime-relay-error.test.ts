import { expect, it } from 'vitest'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from '../hive-runtime-cloud-http-client'
import { hiveRuntimeRelayError } from './hive-runtime-relay-error'

it.each(['STALE_BINDING', 'ASSIGNMENT_AUTHORITY_STALE', 'NO_ELIGIBLE_CELL'])(
  'preserves the declared cloud rejection %s without carrying the raw error',
  (code) => {
    expect(hiveRuntimeRelayError(new HiveRuntimeCloudRequestError(409, code))).toEqual({
      code,
      httpStatus: 409
    })
  }
)

it('discards unrecognized cloud text and arbitrary exception details', () => {
  const secret = 'Bearer private-token https://cell.example/?controlLease=secret'
  expect(hiveRuntimeRelayError(new HiveRuntimeCloudRequestError(503, secret))).toEqual({
    code: 'CLOUD_REQUEST_FAILED',
    httpStatus: 503
  })
  expect(hiveRuntimeRelayError(new Error(secret))).toEqual({
    code: 'RELAY_CONNECTION_FAILED',
    httpStatus: null
  })
  expect(hiveRuntimeRelayError(new HiveRuntimeCloudTransportError())).toEqual({
    code: 'CLOUD_UNREACHABLE',
    httpStatus: null
  })
})

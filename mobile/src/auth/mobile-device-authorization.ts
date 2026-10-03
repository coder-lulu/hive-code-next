import nacl from 'tweetnacl'
import { MOBILE_CLIENT_ID, MOBILE_SESSION_PROFILE } from './mobile-auth-contract'
import { deviceIdentity, encodeBase64Url, request } from './mobile-sms-client'

export async function registerMobileDeviceAuthorization(nonce: string): Promise<void> {
  const identity = await deviceIdentity()
  const proofInput = `hive-device-authorization-v2\n${nonce}\n${MOBILE_CLIENT_ID}\n${identity.deviceLabel}\n${MOBILE_SESSION_PROFILE}`
  const proof = encodeBase64Url(
    nacl.sign.detached(new TextEncoder().encode(proofInput), identity.secretKey)
  )
  await request('/hive/v1/auth/device-authorizations', {
    nonce,
    clientId: MOBILE_CLIENT_ID,
    devicePublicKey: identity.publicKey,
    deviceLabel: identity.deviceLabel,
    sessionProfile: MOBILE_SESSION_PROFILE,
    proof
  })
}

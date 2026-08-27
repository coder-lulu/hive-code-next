import type { RuntimeCapability } from '../../../shared/protocol-version'
import {
  authenticateCloudManagedE2EE,
  type CloudManagedE2EEAuth
} from './cloud-managed-e2ee-auth-validation'
import { authenticateMobileE2EE } from './mobile-e2ee-auth-validation'
import type { DesktopMobileE2EEV2Session } from './mobile-e2ee-v2-desktop-session'
import { parseRuntimeClientCapabilities } from './runtime-client-capabilities'

type E2EEPrincipalKind = 'paired_device' | 'cloud_managed_web_session'

export type E2EEAuthenticatedDevice = {
  deviceId: string
  deviceToken: string
  scope: 'mobile' | 'runtime'
}

export type E2EEAuthenticatedCloudSession = Readonly<{
  principalKind: 'cloud_managed_web_session'
  managedWebSessionId: string
  runtimeSessionId: string
  expiresAt: number
}>

export type E2EECloudManagedSessionResolver = (
  auth: CloudManagedE2EEAuth
) => E2EEAuthenticatedCloudSession | null

type AuthenticationResult =
  | {
      ok: true
      principalKind: 'paired_device'
      principal: E2EEAuthenticatedDevice
      clientCapabilities: readonly RuntimeCapability[]
    }
  | {
      ok: true
      principalKind: 'cloud_managed_web_session'
      principal: E2EEAuthenticatedCloudSession
      clientCapabilities: readonly RuntimeCapability[]
    }
  | {
      ok: false
      principalKind: 'paired_device' | 'cloud_managed_web_session'
      code: 'bad_auth' | 'unauthorized'
    }

export function authenticateE2EEChannel(args: {
  plaintext: string
  v2Session: DesktopMobileE2EEV2Session | null
  resolveDevice: (token: string) => E2EEAuthenticatedDevice | null
  resolveCloudSession?: E2EECloudManagedSessionResolver
}): AuthenticationResult {
  if (args.resolveCloudSession) {
    const cloud = authenticateCloudManagedE2EE({
      plaintext: args.plaintext,
      resolveSession: args.resolveCloudSession
    })
    if (cloud.kind === 'authenticated') {
      return {
        ok: true,
        principalKind: 'cloud_managed_web_session',
        principal: cloud.principal,
        clientCapabilities: parseRuntimeClientCapabilities(cloud.auth.clientCapabilities)
      }
    }
    if (cloud.kind !== 'not_cloud') {
      return {
        ok: false,
        principalKind: 'cloud_managed_web_session',
        code: cloud.kind === 'bad_auth' ? 'bad_auth' : 'unauthorized'
      }
    }
  }

  const paired = authenticateMobileE2EE({
    plaintext: args.plaintext,
    v2Session: args.v2Session,
    resolveDevice: args.resolveDevice
  })
  return paired.ok
    ? {
        ok: true,
        principalKind: 'paired_device',
        principal: paired.device,
        clientCapabilities: parseRuntimeClientCapabilities(paired.auth.clientCapabilities)
      }
    : { ok: false, principalKind: 'paired_device', code: paired.code }
}

export function rejectE2EEAuthentication(
  code: 'bad_auth' | 'unauthorized',
  principalKind: E2EEPrincipalKind,
  send: (message: unknown) => void,
  close: (code: number, reason: string, principalKind?: E2EEPrincipalKind) => void
): void {
  send({ type: 'e2ee_error', error: { code } })
  const reason = code === 'bad_auth' ? 'Invalid e2ee_auth' : 'Unauthorized'
  if (principalKind === 'cloud_managed_web_session') {
    close(4001, reason, principalKind)
  } else {
    close(4001, reason)
  }
}

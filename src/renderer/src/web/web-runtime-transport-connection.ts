import type { PairedRuntimeConnection } from '../../../shared/paired-runtime-connection'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'

export type WebRuntimeTransportConnection =
  | PairedRuntimeConnection
  | {
      endpoint: string
      hostPublicKeyB64: string
      credential: { kind: 'cloud-managed'; bootstrap: CloudLaunchBootstrap }
    }
export function webRuntimeTransportConnection(
  input: PairedRuntimeConnection | CloudLaunchBootstrap
): WebRuntimeTransportConnection {
  return 'protocolVersion' in input
    ? {
        endpoint: input.websocketUrl,
        hostPublicKeyB64: input.serverPublicKeyB64,
        credential: { kind: 'cloud-managed', bootstrap: input }
      }
    : input
}
export function webRuntimeToken(connection: WebRuntimeTransportConnection): string | undefined {
  return connection.credential.kind === 'cloud-managed'
    ? undefined
    : connection.credential.deviceToken
}

export function webRuntimeTransportCredential(
  connection: WebRuntimeTransportConnection
): Record<string, never> | { deviceToken: string } {
  return connection.credential.kind === 'token'
    ? { deviceToken: connection.credential.deviceToken }
    : {}
}

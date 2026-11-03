// Refuse page-side host removal and keep native push-registration imports outside the bundle; the page has no credential/gateway client.
import { PageHostRemovalUnavailableError } from './page-host-removal-refusal'

export function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void
): Promise<void>
export function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void,
  expectedPairingRevision: string | null,
  afterRemoval?: () => void | Promise<void>
): Promise<boolean>
export function removeHostAndCloseClient(
  _hostId: string,
  _forgetHostClient: (hostId: string) => void,
  _expectedPairingRevision?: string | null,
  _afterRemoval?: () => void | Promise<void>
): Promise<void | boolean> {
  return Promise.reject(new PageHostRemovalUnavailableError())
}

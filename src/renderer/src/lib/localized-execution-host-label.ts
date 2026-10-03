import {
  getExecutionHostLabel,
  getLocalExecutionHostLabel,
  parseExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../shared/execution-host'
import type { ExecutionHostRegistryEntry } from '../../../shared/execution-host-registry'
import { translate } from '@/i18n/i18n'

export function getLocalizedLocalExecutionHostLabel(
  platform: NodeJS.Platform | null = null,
  language?: string
): string {
  const fallback = getLocalExecutionHostLabel(platform)
  const key =
    fallback === 'Local Mac'
      ? 'executionHost.localMac'
      : fallback === 'Local Windows'
        ? 'executionHost.localWindows'
        : fallback === 'Local Linux'
          ? 'executionHost.localLinux'
          : 'executionHost.thisComputer'
  return translate(key, fallback, language ? { lng: language } : undefined)
}

export function getLocalizedExecutionHostLabel(
  hostId: ExecutionHostScope | null | undefined,
  language?: string
): string {
  return parseExecutionHostId(hostId)?.kind === 'local'
    ? getLocalizedLocalExecutionHostLabel(null, language)
    : getExecutionHostLabel(hostId)
}

export function localizeExecutionHostRegistry(
  hosts: readonly ExecutionHostRegistryEntry[],
  hostLabelOverrides?: ReadonlyMap<ExecutionHostId, string>,
  language?: string
): ExecutionHostRegistryEntry[] {
  return hosts.map((host) =>
    host.kind === 'local'
      ? {
          ...host,
          label: hostLabelOverrides?.has(host.id)
            ? host.label
            : getLocalizedLocalExecutionHostLabel(null, language),
          detail: translate(
            'executionHost.thisComputer',
            'This computer',
            language ? { lng: language } : undefined
          )
        }
      : host
  )
}

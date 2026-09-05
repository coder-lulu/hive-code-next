import type { ConnectionState, HostCatalogEntry } from '../transport/types'

export type RuntimeSelectorConnectionStates = Readonly<Record<string, ConnectionState>>
export type RuntimeSelectorTone = 'success' | 'warning' | 'neutral'
export type RuntimeSelectorGroup = 'account' | 'local'

export type RuntimeSelectorEntry = Readonly<{
  id: string
  name: string
  detail: string
  group: RuntimeSelectorGroup
  selectable: boolean
  selected: boolean
  statusLabel: string
  tone: RuntimeSelectorTone
}>

export function projectRuntimeSelectorEntries(
  catalog: readonly HostCatalogEntry[],
  connectionStates: RuntimeSelectorConnectionStates,
  selectedId: string | null,
  now = Date.now()
): RuntimeSelectorEntry[] {
  return catalog
    .map((runtime) => projectRuntime(runtime, connectionStates[runtime.id], selectedId, now))
    .sort((left, right) => groupRank(left.group) - groupRank(right.group))
}

function projectRuntime(
  runtime: HostCatalogEntry,
  connectionState: ConnectionState | undefined,
  selectedId: string | null,
  now: number
): RuntimeSelectorEntry {
  const group = runtime.accessSources?.includes('account-claimed') ? 'account' : 'local'
  const status = runtimeStatus(runtime, connectionState)
  return {
    id: runtime.id,
    name: runtime.name,
    detail: runtimeDetail(runtime, group, connectionState, now),
    group,
    selectable: runtime.profile != null && runtime.credentialStatus === 'ready',
    selected: runtime.id === selectedId,
    ...status
  }
}

function runtimeStatus(
  runtime: HostCatalogEntry,
  connectionState: ConnectionState | undefined
): Pick<RuntimeSelectorEntry, 'statusLabel' | 'tone'> {
  if (connectionState === 'connected') {
    return { statusLabel: '在线', tone: 'success' }
  }
  if (connectionState === 'connecting' || connectionState === 'handshaking') {
    return { statusLabel: '连接中', tone: 'warning' }
  }
  if (connectionState === 'reconnecting') {
    return { statusLabel: '正在重连', tone: 'warning' }
  }
  if (connectionState === 'auth-failed' || runtime.credentialStatus === 'missing') {
    return { statusLabel: '需重新配对', tone: 'warning' }
  }
  if (runtime.credentialStatus === 'cloud-offline') {
    return { statusLabel: '离线', tone: 'neutral' }
  }
  if (runtime.credentialStatus === 'cloud-unavailable') {
    return { statusLabel: '不可连接', tone: 'neutral' }
  }
  if (runtime.credentialStatus === 'temporarily-unavailable') {
    return { statusLabel: '不可验证', tone: 'neutral' }
  }
  if (runtime.accountPresence === 'ONLINE') {
    return { statusLabel: '在线', tone: 'success' }
  }
  return { statusLabel: '不可验证', tone: 'neutral' }
}

function runtimeDetail(
  runtime: HostCatalogEntry,
  group: RuntimeSelectorGroup,
  connectionState: ConnectionState | undefined,
  now: number
): string {
  const prefix = group === 'account' ? '已认领' : '本地配对'
  if (connectionState === 'connected') {
    return `${prefix} · 已连接`
  }
  switch (runtime.credentialStatus) {
    case 'temporarily-unavailable':
      return `${prefix} · 配对凭据暂时不可用`
    case 'missing':
      return `${prefix} · 配对已失效`
    case 'cloud-offline':
      return `${prefix} · Runtime 当前离线`
    case 'cloud-unavailable':
      return `${prefix} · 当前没有可用连接路径`
    case 'ready':
      return runtime.lastConnected > 0
        ? `${prefix} · ${relativeLastConnected(runtime.lastConnected, now)}`
        : `${prefix} · 尚未验证连接`
  }
}

function relativeLastConnected(lastConnected: number, now: number): string {
  const elapsed = Math.max(0, now - lastConnected)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) {
    return '刚刚连接'
  }
  if (minutes < 60) {
    return `上次连接 ${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `上次连接 ${hours} 小时前`
  }
  return `上次连接 ${Math.floor(hours / 24)} 天前`
}

function groupRank(group: RuntimeSelectorGroup): number {
  return group === 'account' ? 0 : 1
}

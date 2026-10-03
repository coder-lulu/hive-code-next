import { exactKeys, isRecord, positiveInteger, uuid } from './hive-runtime-cloud-response'

export type RuntimeWebSessionRevocationCommand = Readonly<{
  managedWebSessionId: string
  runtimeSessionId: string
  controlVersion: number
  action: 'REVOKE'
}>

export type RuntimeWebSessionControlPull = Readonly<{
  commands: readonly RuntimeWebSessionRevocationCommand[]
}>

export function normalizeWebSessionControlPull(value: unknown): RuntimeWebSessionControlPull {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  exactKeys(value, ['commands'])
  if (!Array.isArray(value.commands) || value.commands.length > 100) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  const managedWebSessionIds = new Set<string>()
  return {
    commands: value.commands.map((command) => {
      if (!isRecord(command)) {
        throw new Error('invalid_hive_runtime_cloud_response')
      }
      exactKeys(command, ['managedWebSessionId', 'runtimeSessionId', 'controlVersion', 'action'])
      if (command.action !== 'REVOKE') {
        throw new Error('invalid_hive_runtime_cloud_response')
      }
      const managedWebSessionId = uuid(command.managedWebSessionId)
      if (managedWebSessionIds.has(managedWebSessionId)) {
        throw new Error('invalid_hive_runtime_cloud_response')
      }
      managedWebSessionIds.add(managedWebSessionId)
      return {
        managedWebSessionId,
        runtimeSessionId: uuid(command.runtimeSessionId),
        controlVersion: positiveInteger(command.controlVersion),
        action: 'REVOKE' as const
      }
    })
  }
}

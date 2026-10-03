export type DeviceConnectionsTab = 'hosts' | 'this-computer' | 'access'

export function deviceConnectionsTabForSection(
  sectionId: string | null | undefined
): DeviceConnectionsTab {
  if (sectionId === 'devices-this-computer' || sectionId === 'devices-direct') {
    return 'this-computer'
  }
  if (sectionId === 'devices-access') {
    return 'access'
  }
  return 'hosts'
}

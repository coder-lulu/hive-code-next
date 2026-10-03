import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { useAccountVisibleHostCatalog } from '../src/runtime-directory/use-account-visible-host-catalog'
import { selectConnectableHostProfiles } from '../src/transport/host-catalog-selection'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import VoiceSettingsScreen from '../src/settings/voice-settings-screen'
import { nativeVoiceSettingsOperations } from '../src/settings/native-voice-settings-operations'
export default function NativeVoiceSettingsRoute() {
  const router = useRouter()
  const { catalog } = useAccountVisibleHostCatalog()
  const hosts = useMemo(() => selectConnectableHostProfiles(catalog), [catalog])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const { clients, focused } = useFocusedSettingsHostClients(hostIds)
  const client = clients.find((entry) => entry.state === 'connected')?.client ?? null
  const operations = useMemo(
    () => (client ? nativeVoiceSettingsOperations(client) : null),
    [client]
  )
  return (
    <VoiceSettingsScreen operations={operations} focused={focused} onBack={() => router.back()} />
  )
}

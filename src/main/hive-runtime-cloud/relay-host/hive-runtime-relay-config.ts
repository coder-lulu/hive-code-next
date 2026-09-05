export function hiveRelayV2HostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HIVE_RELAY_V2_HOST_ENABLED === 'true' || env.HIVE_RELAY_V2_HOST_ENABLED === '1'
}

export function hiveRuntimeRelayRegion(env: NodeJS.ProcessEnv = process.env): string {
  const region = env.HIVE_RELAY_REGION
  if (!region || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(region)) {
    throw new Error('hive_runtime_relay_region_invalid')
  }
  return region
}

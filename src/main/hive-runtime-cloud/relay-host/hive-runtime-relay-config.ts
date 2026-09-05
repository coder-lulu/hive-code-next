export function hiveRuntimeRelayRegion(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const region = env.HIVE_RELAY_REGION
  if (region !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(region)) {
    throw new Error('hive_runtime_relay_region_invalid')
  }
  return region
}

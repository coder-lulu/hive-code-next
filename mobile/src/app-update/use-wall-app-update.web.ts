import type { WallAppUpdate } from './use-wall-app-update'

// The page wall leaves package updates to the native HiveCode updater.
export function useWallAppUpdate(): WallAppUpdate | null {
  return null
}

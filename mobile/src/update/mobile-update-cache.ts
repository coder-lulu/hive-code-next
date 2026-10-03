import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { hivecodeProductConfig } from '../generated/product-config'
import { compareProductVersions, isProductVersion } from '../../../src/shared/product-version'
import {
  assertMobileUpdateArtifact,
  parseMobileUpdateDecision,
  MOBILE_UPDATE_CHANNELS
} from './mobile-update-contract'
import { updateEndpointOrigin } from './mobile-update-endpoint'
import { INITIAL_SNAPSHOT, type MobileUpdateSnapshot } from './mobile-update-state'
export const LAST_CHECK_KEY = 'hivecode:update:last-check:v1'
export const CACHED_DECISION_KEY = 'hivecode:update:decision:v1'
export function normalizeAndroidArchitecture(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll('-', '_')
  switch (normalized) {
    case 'arm64':
    case 'arm64v8a':
    case 'arm64_v8a':
      return 'arm64_v8a'
    case 'armeabi':
    case 'armeabi7a':
    case 'armeabi_v7a':
    case 'armv7':
      return 'armeabi_v7a'
    case 'x8664':
    case 'x86_64':
      return 'x86_64'
    default:
      return normalized
  }
}

export function resolveAndroidArchitecture(): string {
  // Android releases are universal APKs. The server must select the single
  // artifact independently of the device ABI.
  return Platform.OS === 'android' ? 'universal' : 'any'
}

export function currentBuildNumber(): number {
  if (Platform.OS === 'ios') {
    const value = Number.parseInt(String(Constants.expoConfig?.ios?.buildNumber ?? '1'), 10)
    return Number.isSafeInteger(value) && value > 0 ? value : 1
  }
  const value = Number(Constants.expoConfig?.android?.versionCode ?? 1)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

export function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}

export function configuredUpdateChannel(): string {
  const channel = hivecodeProductConfig.services.update.channel?.trim().toLowerCase() ?? ''
  if (!MOBILE_UPDATE_CHANNELS.has(channel)) {
    throw new Error('HiveCloud update channel is not configured')
  }
  return channel
}

export async function readCachedUpdateSnapshot(): Promise<MobileUpdateSnapshot | null> {
  try {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return null
    }
    const raw = await AsyncStorage.getItem(CACHED_DECISION_KEY)
    if (!raw) {
      return null
    }
    const cached = JSON.parse(raw) as { decision?: unknown; checkedAt?: unknown }
    if (typeof cached.checkedAt !== 'number' || !Number.isFinite(cached.checkedAt)) {
      return null
    }
    // A cached mandatory decision is cleared by a successful policy refresh
    // or by installing a different build. Wall-clock expiry would let an
    // offline device bypass a known support floor after 24 hours.
    const decision = parseMobileUpdateDecision(cached.decision)
    if (!decision.hasUpdate || !decision.latest) {
      return null
    }
    if (decision.currentBuild !== currentBuildNumber()) {
      return null
    }
    // A cached mandatory decision is a safety policy, not an availability
    // hint.  Only discard it as stale when the locally reported product
    // version is itself valid; malformed legacy metadata must not turn a
    // previously enforced minimum into a fail-open path.
    const localVersion = currentVersion()
    if (isProductVersion(localVersion)) {
      const versionOrder = compareProductVersions(decision.latest.versionName, localVersion)
      if (
        versionOrder < 0 ||
        (versionOrder === 0 && decision.latest.buildNumber <= currentBuildNumber())
      ) {
        return null
      }
    }
    // Android downloads must stay on the configured HiveCloud origin. iOS
    // mandatory decisions are store links and do not need a download origin.
    const allowedOrigin = Platform.OS === 'android' ? updateEndpointOrigin() : null
    if (Platform.OS === 'android' && !allowedOrigin) {
      return null
    }
    const artifact = assertMobileUpdateArtifact(
      decision.latest.artifact,
      Platform.OS,
      allowedOrigin,
      configuredUpdateChannel()
    )
    return {
      ...INITIAL_SNAPSHOT,
      state: 'available',
      version: decision.latest.versionName,
      buildNumber: decision.latest.buildNumber,
      mandatory: decision.updateRequired || decision.latest.mandatory,
      minimumSupportedBuild: decision.minimumSupportedBuild,
      message: decision.latest.releaseNotes,
      artifact,
      promptVisible: true,
      totalBytes: artifact.size ?? 0
    }
  } catch {
    return null
  }
}

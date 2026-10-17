import type {
  ConnectCurrentOrcaProfileResult,
  CreateCloudLinkedOrcaProfileArgs,
  CreateCloudLinkedOrcaProfileResult,
  OrcaProfileAuthStatus,
  SelectOrcaProfileOrgResult,
  SignOutCurrentOrcaProfileResult
} from '../../shared/orca-profiles'
import { getProductCloudAuthConfig } from '../product/product-cloud-config'
import { ensureActiveOrcaProfile } from './profile-index-store'
import { isOrcaCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  readCloudSession,
  takeCloudSessionTicket,
  isCloudSessionTicketCurrent,
  signInCloudSession,
  signOutCloudSession
} from './profile-cloud-session-owner'
import {
  createOrcaCloudProfile,
  exchangeOrcaCloudAuthCode,
  revokeOrcaCloudSession
} from './profile-cloud-client'
import { beginOrcaCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedOrcaProfileRecord,
  linkOrcaProfileToCloud,
  unlinkOrcaProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshOrcaCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevOrcaCloudProfile,
  createDevCloudLinkedOrcaProfile,
  selectDevOrcaCloudOrg
} from './profile-cloud-dev-service'
import { getOrcaProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrg } from './profile-cloud-org-selection'

export { refreshCurrentOrcaProfileAuth } from './profile-cloud-capability-refresh'

let nextCloudConnectAttempt = 0
let linkedCloudConnectAttempt = 0

function invalidateOutstandingCloudConnectAttempts(): void {
  nextCloudConnectAttempt += 1
  linkedCloudConnectAttempt = nextCloudConnectAttempt
}

function isUserCancelledAuthError(message: string): boolean {
  return message === 'orca_cloud_auth_timeout' || message === 'orca_cloud_auth_denied'
}

function activeAuth(
  active: ReturnType<typeof ensureActiveOrcaProfile>,
  userDataPath: string
): OrcaProfileAuthStatus {
  return getOrcaProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentOrcaProfileAuthStatus(userDataPath: string): OrcaProfileAuthStatus {
  return getOrcaProfileAuthStatusFromProfile(ensureActiveOrcaProfile(userDataPath), userDataPath)
}

export async function connectCurrentOrcaProfile(
  userDataPath: string
): Promise<ConnectCurrentOrcaProfileResult> {
  const active = ensureActiveOrcaProfile(userDataPath)
  if (isOrcaCloudDevAuthEnabled()) {
    const list = connectDevOrcaCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getProductCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  const attempt = ++nextCloudConnectAttempt
  try {
    const code = await beginOrcaCloudPkceFlow(configState.config, active.profile.id)
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentOrcaProfileAuthStatus(userDataPath)
      }
    }
    const exchange = await exchangeOrcaCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    if (attempt < linkedCloudConnectAttempt) {
      return {
        status: 'cancelled',
        auth: getCurrentOrcaProfileAuthStatus(userDataPath)
      }
    }
    signInCloudSession(active.profile.id, userDataPath, exchange)
    const list = linkOrcaProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    linkedCloudConnectAttempt = attempt
    return {
      status: 'connected',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isUserCancelledAuthError(message)) {
      return {
        status: 'cancelled',
        auth: getCurrentOrcaProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      error: message
    }
  }
}

export async function signOutCurrentOrcaProfile(
  userDataPath: string
): Promise<SignOutCurrentOrcaProfileResult> {
  // Why: a Sign in click still waiting in the browser must not relink after
  // the user explicitly signed out.
  invalidateOutstandingCloudConnectAttempts()
  const signOutEpoch = linkedCloudConnectAttempt
  const active = ensureActiveOrcaProfile(userDataPath)
  const configState = getProductCloudAuthConfig()
  const session = readCloudSession(active.profile.id, userDataPath)
  // Persist the destructive fence before network revoke, even if deletion later fails.
  signOutCloudSession(active.profile.id, userDataPath)
  if (!isOrcaCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeOrcaCloudSession(configState.config, session.session).catch(() => undefined)
  }
  if (linkedCloudConnectAttempt > signOutEpoch) {
    const current = ensureActiveOrcaProfile(userDataPath)
    return {
      status: 'signed-out',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: current.index.activeProfileId,
      profiles: current.index.profiles
    }
  }
  signOutCloudSession(active.profile.id, userDataPath)
  const list = unlinkOrcaProfileFromCloud(active.profile.id, userDataPath)
  return {
    status: 'signed-out',
    auth: getCurrentOrcaProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedOrcaProfile(
  userDataPath: string,
  args: CreateCloudLinkedOrcaProfileArgs
): Promise<CreateCloudLinkedOrcaProfileResult> {
  const active = ensureActiveOrcaProfile(userDataPath)
  if (isOrcaCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedOrcaProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getProductCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    if (!active.profile.cloud) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
    const operation = await runWithFreshOrcaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createOrcaCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const current = ensureActiveOrcaProfile(userDataPath)
    if (
      !isCloudSessionTicketCurrent(active.profile.id, userDataPath, ticket) ||
      current.profile.id !== active.profile.id ||
      current.profile.cloud?.userId !== active.profile.cloud.userId ||
      current.profile.cloud?.cloudProfileId !== active.profile.cloud.cloudProfileId ||
      current.profile.cloud?.activeOrgId !== active.profile.cloud.activeOrgId
    ) {
      return {
        status: 'failed',
        auth: getCurrentOrcaProfileAuthStatus(userDataPath),
        error: 'stale_cloud_session_mutation'
      }
    }
    const created = operation.value
    const list = createCloudLinkedOrcaProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    signInCloudSession(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentOrcaProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectOrcaProfileOrgResult> {
  const active = ensureActiveOrcaProfile(userDataPath)
  if (isOrcaCloudDevAuthEnabled()) {
    const result = selectDevOrcaCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getProductCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrg({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentOrcaProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

import type { SkillCloudOperation, SkillCloudOptions } from '../../shared/skill-cloud-contract'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import { runWithFreshOrcaCloudSession } from '../orca-profiles/profile-cloud-session-refresh'
import { getProductArtifactCloudConfig } from '../product/product-artifact-cloud-config'
import { getProductCloudAuthConfig } from '../product/product-cloud-config'
import { allowsArtifactCloudAuthOverride } from '../artifacts/artifact-cloud-config'

export async function runSkillCloudOperation<T>(input: {
  userDataPath: string
  options: SkillCloudOptions
  operation(token: string, apiUrl: string): Promise<T>
}): Promise<SkillCloudOperation<T>> {
  const override = input.options.authToken?.trim() || process.env.ORCA_CLOUD_AUTH_TOKEN?.trim()
  if (override && !allowsArtifactCloudAuthOverride()) {
    throw new Error('Skill authentication overrides are available only in development builds.')
  }
  const artifactConfig = getProductArtifactCloudConfig(input.options.apiUrl)
  if (!artifactConfig.configured) {
    return { status: 'unconfigured', message: artifactConfig.setupMessage }
  }
  const apiUrl = artifactConfig.apiUrl
  const active = ensureActiveOrcaProfile(input.userDataPath)
  const stamp = {
    profileId: active.profile.id,
    userId: active.profile.cloud?.userId,
    cloudProfileId: active.profile.cloud?.cloudProfileId,
    organizationId: active.profile.cloud?.activeOrgId ?? ''
  }
  const assertCurrent = () => {
    const current = ensureActiveOrcaProfile(input.userDataPath)
    if (
      current.profile.id !== stamp.profileId ||
      current.profile.cloud?.userId !== stamp.userId ||
      current.profile.cloud?.cloudProfileId !== stamp.cloudProfileId ||
      (current.profile.cloud?.activeOrgId ?? '') !== stamp.organizationId
    ) {
      throw new Error('The signed-in Orca account changed during the skill request.')
    }
  }
  if (override) {
    const value = await input.operation(override, apiUrl)
    assertCurrent()
    return { status: 'ok', value }
  }
  const config = getProductCloudAuthConfig()
  if (!config.configured) {
    return { status: 'unconfigured', message: config.setupMessage }
  }
  const result = await runWithFreshOrcaCloudSession(
    config.config,
    active,
    input.userDataPath,
    async (session) => {
      const value = await input.operation(session.accessToken, apiUrl)
      assertCurrent()
      return value
    }
  )
  return result.status === 'ok'
    ? { status: 'ok', value: result.value }
    : { status: 'reconnect-required' }
}

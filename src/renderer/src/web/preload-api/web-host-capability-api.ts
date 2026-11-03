import { createPreflightApi as createCurrentPreflightApi } from './web-preflight-api'
import type { PreloadApi } from '../../../../preload/api-types'
import type {
  ComputerUsePermissionSetupResult,
  ComputerUsePermissionStatusResult
} from '../../../../shared/computer-use-permissions-types'
import type { SkillDiscoveryResult } from '../../../../shared/skills'
import type { SkillDeletePlan, SkillDeleteResult } from '../../../../shared/skill-delete-contract'
import { SKILL_DELETE_CAPABILITY } from '../../../../shared/skill-install-capability'
import { callRuntimeResult, getRemoteRuntimeStatus } from './web-runtime-calls'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'
import { getBrowserPlatform } from './web-storage'

export function createPreflightApi(): NonNullable<Partial<PreloadApi>['preflight']> {
  return createCurrentPreflightApi({ callRuntimeResult, requireActiveEnvironmentOrNull })
}

export function createDeveloperPermissionsApi(): NonNullable<
  Partial<PreloadApi>['developerPermissions']
> {
  return {
    getStatus: () => Promise.resolve([]),
    request: ({ id }) =>
      Promise.resolve({ id, status: 'unsupported', openedSystemSettings: false } as const),
    openSettings: () => Promise.resolve(),
    testLocalNetworkConnection: ({ host, port }) =>
      Promise.resolve({
        ok: false,
        host,
        port,
        testedAt: Date.now(),
        failure: 'unsupported'
      } as const)
  }
}

export function createComputerUsePermissionsApi(): NonNullable<
  Partial<PreloadApi>['computerUsePermissions']
> {
  return {
    getStatus: () =>
      callRuntimeResult<ComputerUsePermissionStatusResult>(
        'computer.permissionsStatus',
        {},
        15_000
      ),
    openSetup: (args) =>
      callRuntimeResult<ComputerUsePermissionSetupResult>(
        'computer.permissions',
        args ?? {},
        15_000
      ).catch((error: unknown) => {
        // Only a host without this method falls back; real failures (e.g. a cancelled Open) must surface.
        if (!(error instanceof Error && 'code' in error && error.code === 'method_not_found')) {
          throw error
        }
        return {
          platform: getBrowserPlatform(),
          helperAppPath: null,
          openedSettings: false,
          launchedHelper: false,
          nextStep: 'Computer-use permissions are managed on the Orca server.'
        }
      }),
    reset: () =>
      Promise.resolve({
        platform: getBrowserPlatform(),
        helperAppPath: null,
        helperUnavailableReason: 'web_client',
        bundleId: null,
        permissions: []
      })
  }
}

export function createSkillsApi(): NonNullable<Partial<PreloadApi>['skills']> {
  return {
    discover: (target) =>
      callRuntimeResult<SkillDiscoveryResult>('skills.discover', target, 15_000),
    // Why: browser clients have no local skill homes; remote hosts plan their own (not here).
    bundledPlan: () => Promise.reject(new Error('Updating Orca skills requires the desktop app.')),
    bundledExecute: () =>
      Promise.reject(new Error('Updating Orca skills requires the desktop app.')),
    prepareShare: () => Promise.reject(new Error('Skill publishing requires the desktop app.')),
    publishShare: () => Promise.reject(new Error('Skill publishing requires the desktop app.')),
    cancelShare: () => Promise.resolve(),
    releaseShare: () => Promise.resolve(),
    resolveShare: () => Promise.reject(new Error('Skill share links require the desktop app.')),
    installShare: () => Promise.reject(new Error('Skill installation requires the desktop app.')),
    installBundleShare: () =>
      Promise.reject(new Error('Skill installation requires the desktop app.')),
    installPackageVersion: () =>
      Promise.reject(new Error('Skill installation requires the desktop app.')),
    installBundlePackageVersion: () =>
      Promise.reject(new Error('Skill installation requires the desktop app.')),
    cancelInstall: () => Promise.resolve({ cancelled: false }),
    previewInstall: () => Promise.reject(new Error('Skill installation requires the desktop app.')),
    previewBundleInstall: () =>
      Promise.reject(new Error('Skill installation requires the desktop app.')),
    removeInstall: () => Promise.reject(new Error('Skill installation requires the desktop app.')),
    // Disable deletion when the paired host predates the capability.
    deleteSupported: async () => {
      const status = await getRemoteRuntimeStatus().catch(() => null)
      return status?.capabilities?.includes(SKILL_DELETE_CAPABILITY) === true
    },
    previewDelete: (request) =>
      callRuntimeResult<SkillDeletePlan>('skills.previewDelete', request, 60_000),
    delete: (request) => callRuntimeResult<SkillDeleteResult>('skills.delete', request, 5 * 60_000),
    listManagedInstalls: () =>
      Promise.reject(new Error('Skill installation requires the desktop app.')),
    getPackage: () => Promise.reject(new Error('Skill installation requires the desktop app.')),
    listOwnedShares: () =>
      Promise.reject(new Error('Skill package management requires the desktop app.')),
    revokeShare: () =>
      Promise.reject(new Error('Skill package management requires the desktop app.')),
    deletePackage: () =>
      Promise.reject(new Error('Skill package management requires the desktop app.')),
    listWslDistros: () => Promise.resolve([]),
    onInstallProgress: () => () => {},
    onShareProgress: () => () => {}
  }
}

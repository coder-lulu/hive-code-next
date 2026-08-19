import { execFileAsync, acquire, release } from '../../gh-utils'
import { getProductStarRepository } from '../../../product/product-external-service-endpoints'
export const ORCA_REPO = 'stablyai/orca'

/**
 * Check if the authenticated user has starred the Orca repo.
 * Returns true if starred, false if not, null if unable to determine (gh unavailable).
 */
export async function checkOrcaStarred(): Promise<boolean | null> {
  const repository = getProductStarRepository()
  if (!repository) {
    return null
  }
  await acquire()
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['api', '--include', `user/starred/${repository}`],
      { encoding: 'utf-8' }
    )
    const response = `${stdout ?? ''}\n${stderr ?? ''}`
    if (/HTTP\/\S+\s+(?:200|204)\b/.test(response)) {
      return true
    }
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 404 means the user hasn't starred — the only expected "no" answer
    if (message.includes('HTTP 404')) {
      return false
    }
    // Anything else (gh not installed, not authenticated, network issue)
    return null
  } finally {
    release()
  }
}

/**
 * Star the Orca repo for the authenticated user.
 */
export async function starOrca(): Promise<boolean> {
  const repository = getProductStarRepository()
  if (!repository) {
    return false
  }
  await acquire()
  try {
    await execFileAsync('gh', ['api', '-X', 'PUT', `user/starred/${repository}`], {
      encoding: 'utf-8'
    })
    return true
  } catch {
    return false
  } finally {
    release()
  }
}

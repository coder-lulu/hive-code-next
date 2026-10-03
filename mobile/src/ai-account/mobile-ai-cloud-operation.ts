import { fetch as nativeFetch } from 'expo/fetch'
import { AI_BENEFITS_MAXIMUM_RESPONSE_BYTES } from '../../../src/shared/hive-ai-account'
import { MobileApiError, request } from '../auth/mobile-sms-client'
import type { MobileSession } from '../auth/mobile-sms-session'
import { MobileAiCloudUnauthorizedError } from './mobile-ai-cloud-error'

export async function runMobileAiCloud<T>(
  session: MobileSession,
  signal: AbortSignal,
  operation: (send: (path: string) => Promise<unknown>) => Promise<T>,
  method: 'GET' | 'POST' = 'GET'
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  let rejectCancelled!: (failure: Error) => void
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = reject
  })
  const rejectAbort = () => rejectCancelled(new Error('mobile_ai_cloud_unavailable'))
  controller.signal.addEventListener('abort', rejectAbort, { once: true })
  signal.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(abort, 15_000)
  const options = {
    method,
    fetchImpl: nativeFetch,
    credentials: 'omit' as const,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Cache-Control': 'no-store' },
    cache: 'no-store' as const,
    redirect: 'error' as const,
    maximumResponseBytes: 65_536,
    signal: controller.signal
  }
  try {
    if (
      signal.aborted ||
      session.expiresAt <= Date.now() ||
      session.sessionExpiresAt <= Date.now()
    ) {
      throw new Error('mobile_ai_cloud_unavailable')
    }
    const value = await operation(async (path) => {
      if (controller.signal.aborted || session.sessionExpiresAt <= Date.now()) {
        throw new Error('mobile_ai_cloud_unavailable')
      }
      const result = await Promise.race([
        request(path, undefined, {
          ...options,
          maximumResponseBytes:
            path === '/hive/v1/ai/benefits'
              ? AI_BENEFITS_MAXIMUM_RESPONSE_BYTES
              : options.maximumResponseBytes
        }),
        cancelled
      ])
      if (controller.signal.aborted || session.sessionExpiresAt <= Date.now()) {
        throw new Error('mobile_ai_cloud_unavailable')
      }
      return result
    })
    return value
  } catch (error) {
    if (!controller.signal.aborted && error instanceof MobileApiError && error.status === 401) {
      throw new MobileAiCloudUnauthorizedError()
    }
    throw new Error('mobile_ai_cloud_unavailable')
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAbort)
  }
}

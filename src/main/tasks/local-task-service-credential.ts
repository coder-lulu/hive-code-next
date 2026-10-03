import { randomBytes, timingSafeEqual } from 'node:crypto'
import { TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'

/** Rotate the service secret without changing the stable replay caller. Never pass it to Agent processes. */
export function createLocalTaskServiceCredential(operationCallerKey: string) {
  const caller = Object.freeze({ operationCallerKey: TaskOpaqueRef.parse(operationCallerKey) })
  const secret = randomBytes(32).toString('base64url')
  const expected = Buffer.from(secret)
  return {
    secret,
    authenticate(value: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
        return null
      }
      return timingSafeEqual(Buffer.from(value), expected) ? caller : null
    }
  }
}

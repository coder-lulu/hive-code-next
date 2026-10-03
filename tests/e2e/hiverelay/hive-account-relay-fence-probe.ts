import WebSocket from 'ws'
import { expect } from 'vitest'

export type OldControlCredential = {
  cellUrl: string
  controlLease: string
  assignmentId: string
  expiresAt: number
}

const CELL_CONTROL_CLOCK_SKEW_MS = 30_000

export async function rejectOldControlCredential(credential: OldControlCredential, ca: Buffer[]) {
  const probedAt = Date.now()
  const nominalValidityRemainingMs = credential.expiresAt - probedAt
  const operationalValidityRemainingMs = nominalValidityRemainingMs - CELL_CONTROL_CLOCK_SKEW_MS
  expect(operationalValidityRemainingMs).toBeGreaterThan(5_000)
  const status = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(
      new URL('/v1/host/control', credential.cellUrl).toString().replace(/^https:/, 'wss:'),
      {
        ca,
        perMessageDeflate: false,
        headers: { authorization: `Bearer ${credential.controlLease}` }
      }
    )
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('Old fenced control credential rejection timed out'))
    }, 5_000)
    socket.once('open', () => {
      clearTimeout(timer)
      socket.terminate()
      reject(new Error('Old fenced control credential was accepted'))
    })
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    socket.once('error', () => undefined)
  })
  credential.controlLease = ''
  expect(status).toBe(400)
  return {
    status,
    probedAt,
    nominalValidityRemainingMs,
    operationalValidityRemainingMs,
    clockSkewMs: CELL_CONTROL_CLOCK_SKEW_MS
  }
}

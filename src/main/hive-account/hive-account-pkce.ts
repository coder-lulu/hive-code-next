import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { shell } from 'electron'
import { applyProductBranding } from '../../shared/brand'
import {
  ORCA_CLOUD_CALLBACK_RESPONSE_HEADERS,
  ORCA_CLOUD_CALLBACK_SUCCESS_PAGE
} from '../orca-profiles/profile-cloud-callback-page'

export type HiveAuthorizationCode = {
  authorizationCode: string
  codeVerifier: string
  nonce: string
  redirectUri: string
}

type HivePkceOptions = {
  authorizationEndpoint: string
  clientId: string
  scope: string
  prepareDeviceAuthorization: (nonce: string) => Promise<void>
}

const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function closeServer(server: Server): void {
  try {
    server.closeAllConnections?.()
    server.close()
  } catch {
    // The callback server may already be closed by the browser.
  }
}

function writeInvalidCallback(response: ServerResponse): void {
  response.writeHead(400, ORCA_CLOUD_CALLBACK_RESPONSE_HEADERS)
  response.end(applyProductBranding('Invalid HiveCode sign-in response.'))
}

export function beginHiveAccountPkceFlow(options: HivePkceOptions): Promise<HiveAuthorizationCode> {
  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const nonce = base64Url(randomBytes(32))
  const state = base64Url(randomBytes(32))

  return new Promise((resolve, reject) => {
    let settled = false
    let redirectUri = ''
    const settleFailure = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      closeServer(server)
      reject(error)
    }
    const settleSuccess = (authorizationCode: string): void => {
      if (settled) {
        return
      }
      settled = true
      closeServer(server)
      resolve({ authorizationCode, codeVerifier, nonce, redirectUri })
    }

    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
          response.writeHead(404)
          response.end('Not found')
          return
        }
        if (url.searchParams.get('state') !== state) {
          writeInvalidCallback(response)
          return
        }
        if (url.searchParams.has('error')) {
          response.writeHead(400, ORCA_CLOUD_CALLBACK_RESPONSE_HEADERS)
          response.end(applyProductBranding('HiveCode sign-in was cancelled.'))
          settleFailure(new Error('hive_account_authorization_cancelled'))
          return
        }
        const authorizationCode = url.searchParams.get('code')
        if (!authorizationCode) {
          writeInvalidCallback(response)
          return
        }
        response.writeHead(200, ORCA_CLOUD_CALLBACK_RESPONSE_HEADERS)
        response.end(ORCA_CLOUD_CALLBACK_SUCCESS_PAGE)
        settleSuccess(authorizationCode)
      } catch {
        settleFailure(new Error('hive_account_callback_failed'))
      }
    })

    const timeout = setTimeout(
      () => settleFailure(new Error('hive_account_authorization_timeout')),
      AUTHORIZATION_TIMEOUT_MS
    )
    server.once('close', () => clearTimeout(timeout))
    server.once('error', () => settleFailure(new Error('hive_account_loopback_unavailable')))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        settleFailure(new Error('hive_account_loopback_unavailable'))
        return
      }
      redirectUri = `http://127.0.0.1:${address.port}/auth/callback`
      void options
        .prepareDeviceAuthorization(nonce)
        .then(async () => {
          const authorizeUrl = new URL(options.authorizationEndpoint)
          authorizeUrl.searchParams.set('client_id', options.clientId)
          authorizeUrl.searchParams.set('response_type', 'code')
          authorizeUrl.searchParams.set('redirect_uri', redirectUri)
          authorizeUrl.searchParams.set('scope', options.scope)
          authorizeUrl.searchParams.set('nonce', nonce)
          authorizeUrl.searchParams.set('state', state)
          authorizeUrl.searchParams.set('code_challenge', codeChallenge)
          authorizeUrl.searchParams.set('code_challenge_method', 'S256')
          await shell.openExternal(authorizeUrl.toString())
        })
        .catch(() => settleFailure(new Error('hive_account_authorization_failed')))
    })
  })
}

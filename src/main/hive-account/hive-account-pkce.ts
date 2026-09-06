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
  userLoginUrl?: string
  clientId: string
  scope: string
  acrValues?: string
  maxAgeSeconds?: number
  prompt?: 'login'
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
        if (request.method !== 'GET' || url.pathname !== '/') {
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
      // Keycloak's native-app loopback registration permits an ephemeral port
      // only for the exact http://127.0.0.1 redirect URI. Keep the callback at
      // the origin root so the registered path still matches exactly.
      redirectUri = `http://127.0.0.1:${address.port}`
      void options
        .prepareDeviceAuthorization(nonce)
        .then(async () => {
          if (options.userLoginUrl && !options.acrValues && !options.prompt) {
            const loginUrl = new URL(options.userLoginUrl)
            loginUrl.hash = `native=${Buffer.from(
              JSON.stringify({
                clientId: options.clientId,
                nonce,
                state,
                codeChallenge,
                redirectUri
              })
            ).toString('base64url')}`
            await shell.openExternal(loginUrl.toString())
            return
          }
          const authorizeUrl = new URL(options.authorizationEndpoint)
          authorizeUrl.searchParams.set('client_id', options.clientId)
          authorizeUrl.searchParams.set('response_type', 'code')
          authorizeUrl.searchParams.set('redirect_uri', redirectUri)
          authorizeUrl.searchParams.set('scope', options.scope)
          authorizeUrl.searchParams.set('nonce', nonce)
          authorizeUrl.searchParams.set('state', state)
          authorizeUrl.searchParams.set('code_challenge', codeChallenge)
          authorizeUrl.searchParams.set('code_challenge_method', 'S256')
          if (options.acrValues !== undefined) {
            authorizeUrl.searchParams.set('acr_values', options.acrValues)
          }
          if (options.maxAgeSeconds !== undefined) {
            authorizeUrl.searchParams.set('max_age', String(options.maxAgeSeconds))
          }
          if (options.prompt !== undefined) {
            authorizeUrl.searchParams.set('prompt', options.prompt)
          }
          await shell.openExternal(authorizeUrl.toString())
        })
        .catch(() => settleFailure(new Error('hive_account_authorization_failed')))
    })
  })
}

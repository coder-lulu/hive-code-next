import { request } from 'node:https'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

function transportError(code) {
  return new Error(`HiveCloud artifact transport failed (${code})`)
}

// Native HTTPS has no fetch/Undici response-header deadline. The caller's absolute
// AbortSignal remains authoritative through upload, server verification and response EOF.
export async function artifactRequest(url, { method = 'POST', headers, body, signal }) {
  let target
  let outgoingHeaders
  try {
    target = new URL(url)
    outgoingHeaders = new Headers(headers)
  } catch {
    throw transportError('INVALID_REQUEST')
  }
  if (target.protocol !== 'https:' || target.username || target.password) {
    throw transportError('INVALID_URL')
  }
  if (!signal) {
    throw transportError('MISSING_DEADLINE')
  }
  if (signal.aborted) {
    throw transportError('ABORTED')
  }
  if (typeof body !== 'string' && !(body instanceof Blob)) {
    throw transportError('INVALID_BODY')
  }
  outgoingHeaders.set('accept-encoding', 'identity')
  outgoingHeaders.set(
    'content-length',
    String(typeof body === 'string' ? Buffer.byteLength(body) : body.size)
  )

  return new Promise((resolve, reject) => {
    let source
    let response
    let stopped = false
    let uploadDone = false
    let earlyFailure = false
    let responseExposed = false
    let exposeResponse
    const cleanup = () => signal.removeEventListener('abort', abort)
    const close = () => {
      stopped = true
      cleanup()
      source?.destroy()
      response?.destroy()
      req.destroy()
    }
    const fail = (code) => {
      const error = transportError(code)
      // Preserve the HTTP rejection while stopping an unfinished upload.
      if (earlyFailure && code !== 'ABORTED') {
        return
      }
      source?.destroy(error)
      response?.destroy(error)
      req.destroy(error)
      cleanup()
      reject(error)
    }
    const abort = () => fail('ABORTED')
    // agent:false creates a private agent, avoiding Node's globalAgent timeout.
    let req
    try {
      req = request(target, {
        method,
        headers: Object.fromEntries(outgoingHeaders),
        agent: false
      })
    } catch {
      reject(transportError('INVALID_REQUEST'))
      return
    }
    req.on('error', (error) => {
      const tlsError = [
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'CERT_HAS_EXPIRED',
        'ERR_TLS_CERT_ALTNAME_INVALID'
      ].includes(error.code)
      fail(tlsError ? 'TLS' : signal.aborted ? 'ABORTED' : 'NETWORK')
    })
    req.on('response', (incoming) => {
      response = incoming
      response.on('error', () => {})
      const status = incoming.statusCode
      if (status >= 300 && status < 400 && status !== 304) {
        fail('REDIRECT')
        return
      }
      const encoding = incoming.headers['content-encoding']
      if (encoding && encoding.toLowerCase() !== 'identity') {
        fail('CONTENT_ENCODING')
        return
      }
      earlyFailure = status < 200 || status >= 300
      if (earlyFailure && !uploadDone) {
        source?.destroy()
        req.end()
      }
      const responseHeaders = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
      }
      exposeResponse = () => {
        if (stopped || responseExposed) {
          return
        }
        responseExposed = true
        if ([204, 205, 304].includes(status)) {
          incoming.resume()
          incoming.once('end', close)
          resolve(new Response(null, { status, headers: responseHeaders }))
          return
        }
        const iterator = incoming[Symbol.asyncIterator]()
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { value, done } = await iterator.next()
              if (done) {
                controller.close()
                close()
              } else {
                controller.enqueue(value)
              }
            } catch {
              controller.error(transportError(signal.aborted ? 'ABORTED' : 'NETWORK'))
              close()
            }
          },
          cancel: close
        })
        resolve(new Response(stream, { status, headers: responseHeaders }))
      }
      if (uploadDone || earlyFailure) {
        exposeResponse()
      }
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    try {
      source = typeof body === 'string' ? Readable.from([body]) : Readable.fromWeb(body.stream())
      // Do not pipeline directly into req: a server's early 413/503 must be
      // readable even when stopping the source destroys the upload pipeline.
      const sink = new Writable({
        write(chunk, encoding, callback) {
          req.write(chunk, encoding, callback)
        },
        final(callback) {
          req.end(callback)
        }
      })
      pipeline(source, sink).then(
        () => {
          uploadDone = true
          exposeResponse?.()
        },
        () => {
          if (!earlyFailure && !stopped) {
            fail('SOURCE')
          }
        }
      )
    } catch {
      fail('SOURCE')
    }
  })
}

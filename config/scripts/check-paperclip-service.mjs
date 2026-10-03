import { readFile, stat } from 'node:fs/promises'

async function descriptor(path) {
  if (!path || (await stat(path)).size > 2048) {
    throw new Error('Private task service descriptor unavailable')
  }
  const value = JSON.parse(await readFile(path, 'utf8'))
  const url = new URL(value.baseUrl)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.secret)
  ) {
    throw new Error('Invalid private task service descriptor')
  }
  return value
}
async function probe(path, route) {
  const service = await descriptor(path)
  const response = await fetch(`${service.baseUrl}${route}`, {
    redirect: 'error',
    headers: { Authorization: `Bearer ${service.secret}` },
    signal: AbortSignal.timeout(10_000)
  })
  return { status: response.status, value: await response.json() }
}
const [paperclip, runtime] = await Promise.all([
  probe(process.env.HIVE_PAPERCLIP_SERVICE_DESCRIPTOR, '/hive/health'),
  probe(process.env.HIVE_TASK_TRANSPORT_DESCRIPTOR, '/capabilities')
])
const ready = paperclip.status === 200 && paperclip.value.databaseReady === true
const runtimeReady = runtime.status === 200 && runtime.value.kind === 'execution.capabilities'
console.log(
  JSON.stringify(
    {
      paperclipReady: ready,
      protocolVersion: paperclip.value.protocolVersion,
      paperclipRevision: paperclip.value.paperclipRevision,
      executionAllowlist: paperclip.value.executionAllowlist,
      runtimeAuthorized: runtimeReady,
      runtimeUnavailableCode: runtimeReady ? null : runtime.value.error?.code
    },
    null,
    2
  )
)
process.exitCode = !ready ? 1 : runtimeReady ? 0 : 2

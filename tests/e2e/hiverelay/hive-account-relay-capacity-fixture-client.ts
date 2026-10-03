export function createCapacityFixtureFetch(bridge: URL) {
  return async <T>(path: string, body?: Record<string, unknown>): Promise<T> => {
    const response = await fetch(new URL(path, bridge), {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) {
      const failure = (await response.text()).slice(0, 512)
      throw new Error(`Capacity fixture ${path}: HTTP ${response.status} ${failure}`)
    }
    return response.json() as Promise<T>
  }
}
